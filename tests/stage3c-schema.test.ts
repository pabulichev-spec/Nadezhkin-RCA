import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Stage 3C schema migration", () => {
  const migration = readFileSync(resolve(process.cwd(), "drizzle/0002_zippy_alice.sql"), "utf8");

  it("creates the tenant and investigation tables required by the approved plan", () => {
    for (const table of [
      "workspaces",
      "workspace_members",
      "workspace_invitations",
      "investigations",
      "investigation_members",
      "evidence",
      "rca_results",
      "chat_messages",
      "corrective_actions",
      "tags",
      "investigation_tags",
      "audit_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it("contains tenant foreign keys and does not contain destructive DDL", () => {
    expect((migration.match(/ADD CONSTRAINT/g) ?? []).length).toBeGreaterThanOrEqual(20);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER TABLE `users`/i);
  });

  it("stores no credentials or raw invitation tokens in the schema", () => {
    expect(migration).not.toMatch(/password|api[_-]?key|secret|token`/i);
    expect(migration).toContain("tokenHash");
  });
});
