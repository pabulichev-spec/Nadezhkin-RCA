import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import {
  auditEvents,
  investigationMembers,
  investigations,
  users,
  workspaceMembers,
  workspaces,
} from "../../drizzle/schema";

export type RepositoryPermission = "READ" | "WRITE" | "RUN_AI";
export type WorkspaceRole = "ADMIN" | "MEMBER" | "READER";

export class RepositoryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "VALIDATION" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type WriteDatabase = Pick<Database, "insert">;

export async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new RepositoryError("UNAVAILABLE", "Database is required for this operation");
  return db;
}

export function newId(): string {
  return randomUUID();
}

export function canWorkspaceRole(role: WorkspaceRole, permission: RepositoryPermission): boolean {
  if (role === "ADMIN") return true;
  if (permission === "READ") return true;
  return role === "MEMBER";
}

export function canAccessAllInvestigations(role: WorkspaceRole): boolean {
  return role === "ADMIN";
}

export function canInvestigationPermission(permission: string, required: RepositoryPermission): boolean {
  if (required === "READ") return ["READ", "WRITE", "RUN_AI"].includes(permission);
  if (required === "WRITE") return ["WRITE", "RUN_AI"].includes(permission);
  return permission === "RUN_AI";
}

export async function getWorkspaceMembership(
  db: Database,
  userId: number,
  workspaceId: string,
) {
  const rows = await db
    .select({
      membership: workspaceMembers,
      workspace: workspaces,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, "ACTIVE"),
      eq(workspaces.status, "ACTIVE"),
    ))
    .limit(1);
  return rows[0];
}

export async function requireWorkspaceAccess(
  db: Database,
  userId: number,
  workspaceId: string,
  permission: RepositoryPermission = "READ",
) {
  const membership = await getWorkspaceMembership(db, userId, workspaceId);
  if (!membership || !canWorkspaceRole(membership.membership.role, permission)) {
    throw new RepositoryError("FORBIDDEN", "Workspace access denied");
  }
  return membership;
}

export async function getInvestigationForAccess(
  db: Database,
  userId: number,
  investigationId: string,
  permission: RepositoryPermission = "READ",
) {
  const rows = await db
    .select({
      investigation: investigations,
      workspaceMember: workspaceMembers,
    })
    .from(investigations)
    .innerJoin(workspaceMembers, and(
      eq(workspaceMembers.workspaceId, investigations.workspaceId),
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, "ACTIVE"),
    ))
    .where(eq(investigations.id, investigationId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new RepositoryError("NOT_FOUND", "Investigation not found or access denied");

  const workspaceAllows = canAccessAllInvestigations(row.workspaceMember.role);
  const investigationMember = await db
    .select()
    .from(investigationMembers)
    .where(and(
      eq(investigationMembers.investigationId, investigationId),
      eq(investigationMembers.userId, userId),
    ))
    .limit(1);
  const ownerAllows = row.investigation.ownerId === userId;
  const investigationAllows = investigationMember[0]
    ? canInvestigationPermission(investigationMember[0].permission, permission)
    : false;

  if (!workspaceAllows && !ownerAllows && !investigationAllows) {
    throw new RepositoryError("FORBIDDEN", "Investigation access denied");
  }

  return {
    investigation: row.investigation,
    workspaceMembership: row.workspaceMember,
    investigationMembership: investigationMember[0] ?? null,
  };
}

export async function assertUserExists(db: Database, userId: number) {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) throw new RepositoryError("VALIDATION", "User does not exist");
}

export async function appendAuditEvent(
  db: WriteDatabase,
  input: {
    workspaceId?: string | null;
    actorId?: number | null;
    investigationId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    outcome?: "SUCCESS" | "DENIED" | "FAILURE";
    requestId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  await db.insert(auditEvents).values({
    id: newId(),
    workspaceId: input.workspaceId ?? null,
    actorId: input.actorId ?? null,
    investigationId: input.investigationId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    outcome: input.outcome ?? "SUCCESS",
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? null,
  });
}
