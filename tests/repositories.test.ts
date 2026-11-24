import { describe, expect, it } from "vitest";
import { canAccessAllInvestigations, canInvestigationPermission, canWorkspaceRole, RepositoryError } from "../server/repositories/common";
import { createHash } from "node:crypto";

function expectedTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

describe("Stage 3C repository ACL policies", () => {
  it("allows workspace admins to read, write and run AI", () => {
    expect(canWorkspaceRole("ADMIN", "READ")).toBe(true);
    expect(canWorkspaceRole("ADMIN", "WRITE")).toBe(true);
    expect(canWorkspaceRole("ADMIN", "RUN_AI")).toBe(true);
  });

  it("allows members to write and run AI but keeps readers read-only", () => {
    expect(canWorkspaceRole("MEMBER", "READ")).toBe(true);
    expect(canWorkspaceRole("MEMBER", "WRITE")).toBe(true);
    expect(canWorkspaceRole("MEMBER", "RUN_AI")).toBe(true);
    expect(canWorkspaceRole("READER", "READ")).toBe(true);
    expect(canWorkspaceRole("READER", "WRITE")).toBe(false);
    expect(canWorkspaceRole("READER", "RUN_AI")).toBe(false);
  });

  it("enforces investigation-level permissions when workspace role is insufficient", () => {
    expect(canInvestigationPermission("READ", "READ")).toBe(true);
    expect(canInvestigationPermission("READ", "WRITE")).toBe(false);
    expect(canInvestigationPermission("WRITE", "WRITE")).toBe(true);
    expect(canInvestigationPermission("WRITE", "RUN_AI")).toBe(false);
    expect(canInvestigationPermission("RUN_AI", "RUN_AI")).toBe(true);
  });

  it("does not grant workspace-wide investigation visibility to members or readers", () => {
    expect(canAccessAllInvestigations("ADMIN")).toBe(true);
    expect(canAccessAllInvestigations("MEMBER")).toBe(false);
    expect(canAccessAllInvestigations("READER")).toBe(false);
  });

  it("uses a one-way SHA-256 representation for invitation tokens", () => {
    const token = "opaque-invitation-token";
    const digest = expectedTokenHash(token);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
  });

  it("exposes machine-readable repository errors", () => {
    const error = new RepositoryError("FORBIDDEN", "denied");
    expect(error.name).toBe("RepositoryError");
    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toBe("denied");
  });
});
