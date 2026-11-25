import { describe, expect, it } from "vitest";
import { ENV, assertProductionSecurityConfig } from "../server/_core/env";

describe("production JWT security", () => {
  it("loads a strong project secret and passes the production security gate", async () => {
    expect(ENV.cookieSecret.length).toBeGreaterThanOrEqual(32);
    expect(() => assertProductionSecurityConfig({
      ...ENV,
      isProduction: true,
      appId: ENV.appId || "configured-app",
      oAuthServerUrl: ENV.oAuthServerUrl || "https://oauth.manus.im",
      explicitAllowedOrigins: ENV.explicitAllowedOrigins.length ? ENV.explicitAllowedOrigins : ["https://pump-rca-ntbesymu.manus.space"],
    })).not.toThrow();

    const healthUrl = process.env.PUMPRCA_HEALTHCHECK_URL ?? "https://pump-rca-ntbesymu.manus.space/api/health";
    const response = await fetch(healthUrl, { headers: { accept: "application/json" } });
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
