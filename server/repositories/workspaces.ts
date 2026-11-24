import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "../../drizzle/schema";
import {
  appendAuditEvent,
  assertUserExists,
  newId,
  requireDb,
  requireWorkspaceAccess,
  RepositoryError,
  type WorkspaceRole,
} from "./common";

export type CreateWorkspaceInput = {
  name: string;
};

function normalizeWorkspaceName(name: string): string {
  const value = name.trim();
  if (value.length < 2 || value.length > 160) {
    throw new RepositoryError("VALIDATION", "Workspace name must contain 2-160 characters");
  }
  return value;
}

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createWorkspace(actorId: number, input: CreateWorkspaceInput) {
  const db = await requireDb();
  const name = normalizeWorkspaceName(input.name);
  await assertUserExists(db, actorId);
  const workspaceId = newId();

  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({
      id: workspaceId,
      name,
      createdBy: actorId,
      status: "ACTIVE",
    });
    await tx.insert(workspaceMembers).values({
      id: newId(),
      workspaceId,
      userId: actorId,
      role: "ADMIN",
      status: "ACTIVE",
      invitedBy: actorId,
    });
    await appendAuditEvent(tx, {
      workspaceId,
      actorId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "workspace.created",
      metadata: { name },
    });
  });

  return getWorkspaceForUser(actorId, workspaceId);
}

export async function getWorkspaceForUser(userId: number, workspaceId: string) {
  const db = await requireDb();
  const membership = await requireWorkspaceAccess(db, userId, workspaceId, "READ");
  return {
    ...membership.workspace,
    membership: membership.membership,
  };
}

export async function listWorkspacesForUser(userId: number) {
  const db = await requireDb();
  return db
    .select({
      workspace: workspaces,
      membership: workspaceMembers,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, "ACTIVE"),
      eq(workspaces.status, "ACTIVE"),
    ))
    .orderBy(asc(workspaces.name));
}

export async function listWorkspaceMembers(actorId: number, workspaceId: string) {
  const db = await requireDb();
  await requireWorkspaceAccess(db, actorId, workspaceId, "READ");
  return db
    .select({
      membership: workspaceMembers,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        status: users.status,
      },
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

export async function setWorkspaceMemberRole(
  actorId: number,
  workspaceId: string,
  memberUserId: number,
  role: WorkspaceRole,
) {
  const db = await requireDb();
  const actorMembership = await requireWorkspaceAccess(db, actorId, workspaceId, "WRITE");
  if (actorMembership.membership.role !== "ADMIN") {
    throw new RepositoryError("FORBIDDEN", "Only workspace admins can change member roles");
  }
  if (memberUserId === actorId && role !== "ADMIN") {
    throw new RepositoryError("VALIDATION", "The last workspace admin cannot demote themselves");
  }
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberUserId)))
    .limit(1);
  if (!rows[0]) throw new RepositoryError("NOT_FOUND", "Workspace member not found");

  await db
    .update(workspaceMembers)
    .set({ role, status: "ACTIVE" })
    .where(eq(workspaceMembers.id, rows[0].id));
  await appendAuditEvent(db, {
    workspaceId,
    actorId,
    entityType: "workspace_member",
    entityId: rows[0].id,
    action: "workspace_member.role_changed",
    metadata: { targetUserId: memberUserId, role },
  });
  return db.select().from(workspaceMembers).where(eq(workspaceMembers.id, rows[0].id)).limit(1).then((result) => result[0]);
}

export async function setWorkspaceMemberStatus(
  actorId: number,
  workspaceId: string,
  memberUserId: number,
  status: "ACTIVE" | "SUSPENDED",
) {
  const db = await requireDb();
  const actorMembership = await requireWorkspaceAccess(db, actorId, workspaceId, "WRITE");
  if (actorMembership.membership.role !== "ADMIN") {
    throw new RepositoryError("FORBIDDEN", "Only workspace admins can change member status");
  }
  if (memberUserId === actorId && status !== "ACTIVE") {
    throw new RepositoryError("VALIDATION", "An admin cannot suspend their own membership");
  }
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberUserId)))
    .limit(1);
  if (!rows[0]) throw new RepositoryError("NOT_FOUND", "Workspace member not found");

  await db.update(workspaceMembers).set({ status }).where(eq(workspaceMembers.id, rows[0].id));
  await appendAuditEvent(db, {
    workspaceId,
    actorId,
    entityType: "workspace_member",
    entityId: rows[0].id,
    action: "workspace_member.status_changed",
    metadata: { targetUserId: memberUserId, status },
  });
  return db.select().from(workspaceMembers).where(eq(workspaceMembers.id, rows[0].id)).limit(1).then((result) => result[0]);
}

export async function createWorkspaceInvitation(
  actorId: number,
  input: {
    workspaceId: string;
    targetEmail?: string;
    targetOpenId?: string;
    role: "MEMBER" | "READER";
    expiresAt: Date;
  },
) {
  const db = await requireDb();
  const actorMembership = await requireWorkspaceAccess(db, actorId, input.workspaceId, "WRITE");
  if (actorMembership.membership.role !== "ADMIN") {
    throw new RepositoryError("FORBIDDEN", "Only workspace admins can invite members");
  }
  if (!input.targetEmail && !input.targetOpenId) {
    throw new RepositoryError("VALIDATION", "Invitation requires targetEmail or targetOpenId");
  }
  if (input.expiresAt.getTime() <= Date.now()) {
    throw new RepositoryError("VALIDATION", "Invitation expiration must be in the future");
  }

  const token = randomBytes(32).toString("base64url");
  const invitationId = newId();
  await db.insert(workspaceInvitations).values({
    id: invitationId,
    workspaceId: input.workspaceId,
    targetEmail: input.targetEmail?.trim().toLowerCase() ?? null,
    targetOpenId: input.targetOpenId ?? null,
    tokenHash: hashInvitationToken(token),
    role: input.role,
    status: "PENDING",
    invitedBy: actorId,
    expiresAt: input.expiresAt,
  });
  await appendAuditEvent(db, {
    workspaceId: input.workspaceId,
    actorId,
    entityType: "workspace_invitation",
    entityId: invitationId,
    action: "workspace_invitation.created",
    metadata: { role: input.role, hasEmailTarget: Boolean(input.targetEmail), hasOpenIdTarget: Boolean(input.targetOpenId) },
  });

  return { invitationId, token, expiresAt: input.expiresAt };
}

export async function acceptWorkspaceInvitation(userId: number, token: string) {
  const db = await requireDb();
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw new RepositoryError("NOT_FOUND", "User not found");

  const invitations = await db
    .select()
    .from(workspaceInvitations)
    .where(and(
      eq(workspaceInvitations.tokenHash, hashInvitationToken(token)),
      eq(workspaceInvitations.status, "PENDING"),
      gt(workspaceInvitations.expiresAt, new Date()),
    ))
    .limit(1);
  const invitation = invitations[0];
  if (!invitation) throw new RepositoryError("NOT_FOUND", "Invitation is invalid or expired");

  const emailMatches = invitation.targetEmail && user.email
    ? invitation.targetEmail === user.email.trim().toLowerCase()
    : false;
  const openIdMatches = invitation.targetOpenId && invitation.targetOpenId === user.openId;
  if (!emailMatches && !openIdMatches) {
    throw new RepositoryError("FORBIDDEN", "Invitation target does not match authenticated user");
  }

  await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, invitation.workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    if (existing[0]) {
      await tx.update(workspaceMembers).set({ role: invitation.role, status: "ACTIVE" }).where(eq(workspaceMembers.id, existing[0].id));
    } else {
      await tx.insert(workspaceMembers).values({
        id: newId(),
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        status: "ACTIVE",
        invitedBy: invitation.invitedBy,
      });
    }
    await tx.update(workspaceInvitations).set({ status: "ACCEPTED", acceptedAt: new Date() }).where(eq(workspaceInvitations.id, invitation.id));
    await appendAuditEvent(tx, {
      workspaceId: invitation.workspaceId,
      actorId: userId,
      entityType: "workspace_invitation",
      entityId: invitation.id,
      action: "workspace_invitation.accepted",
      metadata: { role: invitation.role },
    });
  });

  return getWorkspaceForUser(userId, invitation.workspaceId);
}

export async function findUsersForWorkspaceInvite(actorId: number, workspaceId: string, search: string) {
  const db = await requireDb();
  await requireWorkspaceAccess(db, actorId, workspaceId, "READ");
  const normalized = `%${search.trim().toLowerCase()}%`;
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.status, ["active", "pending"]))
    .limit(20);
  return rows.filter((user) => [user.name, user.email].some((value) => value?.toLowerCase().includes(normalized.slice(1, -1))));
}
