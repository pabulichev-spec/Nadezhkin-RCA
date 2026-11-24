import { and, asc, desc, eq } from "drizzle-orm";
import { auditEvents, investigationTags, tags } from "../../drizzle/schema";
import { appendAuditEvent, canAccessAllInvestigations, getInvestigationForAccess, newId, requireDb, requireWorkspaceAccess, RepositoryError } from "./common";
import { listInvestigations } from "./investigations";

function normalizeTagName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) {
    throw new RepositoryError("VALIDATION", "Tag name must contain 1-120 characters");
  }
  return normalized;
}

export async function createTag(actorId: number, workspaceId: string, name: string) {
  const db = await requireDb();
  await requireWorkspaceAccess(db, actorId, workspaceId, "WRITE");
  const displayName = normalizeTagName(name);
  const normalizedName = displayName.toLocaleLowerCase();
  const existing = await db.select().from(tags).where(and(eq(tags.workspaceId, workspaceId), eq(tags.normalizedName, normalizedName))).limit(1);
  if (existing[0]) return existing[0];
  const id = newId();
  await db.insert(tags).values({ id, workspaceId, name: displayName, normalizedName, createdBy: actorId });
  await appendAuditEvent(db, {
    workspaceId,
    actorId,
    entityType: "tag",
    entityId: id,
    action: "tag.created",
    metadata: { normalizedName },
  });
  return db.select().from(tags).where(eq(tags.id, id)).limit(1).then((result) => result[0]);
}

export async function listTags(actorId: number, workspaceId: string) {
  const db = await requireDb();
  await requireWorkspaceAccess(db, actorId, workspaceId, "READ");
  return db.select().from(tags).where(eq(tags.workspaceId, workspaceId)).orderBy(asc(tags.name));
}

export async function attachTag(actorId: number, investigationId: string, tagId: string) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  const tag = await db.select().from(tags).where(and(eq(tags.id, tagId), eq(tags.workspaceId, access.investigation.workspaceId))).limit(1);
  if (!tag[0]) throw new RepositoryError("NOT_FOUND", "Tag not found in investigation workspace");

  const existing = await db.select().from(investigationTags).where(and(eq(investigationTags.investigationId, investigationId), eq(investigationTags.tagId, tagId))).limit(1);
  if (existing[0]) return existing[0];
  const id = newId();
  await db.insert(investigationTags).values({ id, investigationId, tagId, createdBy: actorId });
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "investigation_tag",
    entityId: id,
    action: "investigation_tag.attached",
    metadata: { tagId },
  });
  return db.select().from(investigationTags).where(eq(investigationTags.id, id)).limit(1).then((result) => result[0]);
}

export async function detachTag(actorId: number, investigationId: string, tagId: string) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  const link = await db.select().from(investigationTags).where(and(eq(investigationTags.investigationId, investigationId), eq(investigationTags.tagId, tagId))).limit(1);
  if (!link[0]) return { removed: false } as const;
  await db.delete(investigationTags).where(eq(investigationTags.id, link[0].id));
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "investigation_tag",
    entityId: link[0].id,
    action: "investigation_tag.detached",
    metadata: { tagId },
  });
  return { removed: true } as const;
}

export async function listInvestigationTags(actorId: number, investigationId: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db
    .select({ link: investigationTags, tag: tags })
    .from(investigationTags)
    .innerJoin(tags, eq(investigationTags.tagId, tags.id))
    .where(eq(investigationTags.investigationId, investigationId))
    .orderBy(asc(tags.name));
}

export async function listAuditEvents(
  actorId: number,
  input: { workspaceId: string; investigationId?: string; limit?: number },
) {
  const db = await requireDb();
  const membership = await requireWorkspaceAccess(db, actorId, input.workspaceId, "READ");
  if (input.investigationId) {
    await getInvestigationForAccess(db, actorId, input.investigationId, "READ");
  } else if (!canAccessAllInvestigations(membership.membership.role)) {
    throw new RepositoryError("FORBIDDEN", "Workspace-wide audit access is restricted to admins");
  }
  const conditions = [eq(auditEvents.workspaceId, input.workspaceId)];
  if (input.investigationId) conditions.push(eq(auditEvents.investigationId, input.investigationId));
  return db.select().from(auditEvents).where(and(...conditions)).orderBy(desc(auditEvents.createdAt)).limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
}

export async function listInvestigationSummaryByWorkspace(actorId: number, workspaceId: string) {
  const visible = await listInvestigations(actorId, workspaceId);
  return visible.map((investigation) => ({
    id: investigation.id,
    title: investigation.title,
    status: investigation.status,
    severity: investigation.severity,
    updatedAt: investigation.updatedAt,
  }));
}
