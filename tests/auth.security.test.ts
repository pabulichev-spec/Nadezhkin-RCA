import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { hasValidCsrf, isAllowedOrigin } from "../server/_core/security";
import { assertProductionSecurityConfig } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";

function context(user: TrpcContext["user"], headers: Record<string, string> = {}): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const baseUser = {
  id: 10,
  openId: "security-user",
  name: "Security User",
  email: "security@example.com",
  loginMethod: "manus",
  role: "user" as const,
  sessionVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("Stage 3B authorization boundaries", () => {
  it("rejects anonymous web AI operations before the gateway can run", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.rca.analyze({
      caseTitle: "Unauthorized",
      equipmentType: "Pump",
      assetTag: "P-1",
      location: "Unit 1",
      narrative: "Failure",
      evidence: [],
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects pending users from AI operations", async () => {
    const caller = appRouter.createCaller(context({ ...baseUser, status: "pending" }));
    await expect(caller.rca.analyze({
      caseTitle: "Pending",
      equipmentType: "Pump",
      assetTag: "P-1",
      location: "Unit 1",
      narrative: "Failure",
      evidence: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects disabled users from AI operations", async () => {
    const caller = appRouter.createCaller(context({ ...baseUser, status: "disabled" }));
    await expect(caller.rca.ask({
      caseTitle: "Disabled",
      equipmentType: "Pump",
      assetTag: "P-1",
      location: "Unit 1",
      narrative: "Failure",
      result: {
        executiveSummary: "summary",
        physicalCause: "cause",
        humanFactor: "factor",
        systemicCause: "system",
        smartActions: [],
        confidence: 0,
        openQuestions: [],
        methodNotes: "notes",
        structuredRca: { facts: [], symptoms: [], hypotheses: [], missingData: [] },
      },
      evidence: [],
      history: [],
      question: "What next?",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts only active users for protected boundaries", () => {
    const caller = appRouter.createCaller(context({ ...baseUser, status: "active" }));
    expect(caller).toBeDefined();
  });

  it("returns a public user projection without identity or session internals", async () => {
    const caller = appRouter.createCaller(context({ ...baseUser, status: "active" }));
    const result = await caller.auth.me();
    expect(result).toMatchObject({ id: 10, status: "active", role: "user" });
    expect(result).not.toHaveProperty("openId");
    expect(result).not.toHaveProperty("sessionVersion");
  });

  it("denies admin user management to a regular active user", async () => {
    const caller = appRouter.createCaller(context({ ...baseUser, status: "active", role: "user" }));
    await expect(caller.admin.users()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Stage 3B origin and CSRF policy", () => {
  it("fails production startup without a strong secret and explicit origin", () => {
    expect(() => assertProductionSecurityConfig({
      isProduction: true,
      cookieSecret: "short",
      appId: "app",
      oAuthServerUrl: "https://oauth.example",
      explicitAllowedOrigins: ["https://app.example"],
      allowedOrigins: ["https://app.example"],
    } as any)).toThrow(/JWT_SECRET/);
    expect(() => assertProductionSecurityConfig({
      isProduction: true,
      cookieSecret: "a".repeat(32),
      appId: "app",
      oAuthServerUrl: "https://oauth.example",
      explicitAllowedOrigins: [],
      allowedOrigins: [],
    } as any)).toThrow(/PUMPRCA_ALLOWED_ORIGINS/);
  });

  it("includes sessionVersion in signed sessions", async () => {
    const token = await sdk.createSessionToken("security-user", { name: "Security User", sessionVersion: 7 });
    await expect(sdk.verifySession(token)).resolves.toMatchObject({ openId: "security-user", sessionVersion: 7 });
  });

  it("fails closed for unknown origins in production mode configuration", () => {
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
  });

  it("accepts a matching double-submit CSRF token", () => {
    const token = "a".repeat(64);
    expect(hasValidCsrf({
      headers: {
        cookie: `pumprca_csrf=${token}`,
        "x-csrf-token": token,
      },
    } as any)).toBe(true);
  });

  it("rejects a missing or mismatched CSRF token", () => {
    expect(hasValidCsrf({ headers: { cookie: "pumprca_csrf=good", "x-csrf-token": "bad" } } as any)).toBe(false);
    expect(hasValidCsrf({ headers: { cookie: "pumprca_csrf=good" } } as any)).toBe(false);
  });

  it("allows native bearer requests without browser CSRF cookies", () => {
    expect(hasValidCsrf({ headers: { authorization: "Bearer opaque-token" } } as any)).toBe(true);
  });
});
