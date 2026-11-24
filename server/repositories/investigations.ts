import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  chatMessages,
  correctiveActions,
  evidence,
  auditEvents,
  investigationMembers,
  investigationTags,
  investigations,
  rcaResults,
} from "../../drizzle/schema";
import {
  appendAuditEvent,
  assertUserExists,
  canAccessAllInvestigations,
  getInvestigationForAccess,
  newId,
  requireDb,
  requireWorkspaceAccess,
  RepositoryError,
  type RepositoryPermission,
} from "./common";

export type InvestigationInput = {
  workspaceId: string;
  legacyCaseId?: string | null;
  title: string;
  equipmentType: string;
  assetTag: string;
  location: string;
  narrative: string;
  severity?: string | null;
  status?: string;
  tagsSnapshot?: unknown;
  legacyData?: unknown;
};

export type EvidenceInput = {
  kind: string;
  name: string;
  objectKey?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  mediaHash?: string | null;
  metadata?: unknown;
  note?: string | null;
  annotations?: unknown;
};

export type RcaResultInput = {
  schemaVersion: string;
  promptVersion: string;
  validatorVersion: string;
  validatedJson: unknown;
  provider?: string | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
};

function requiredText(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new RepositoryError("VALIDATION", `${field} is required and must be at most ${max} characters`);
  }
  return normalized;
}

export async function createInvestigation(actorId: number, input: InvestigationInput) {
  const db = await requireDb();
  await requireWorkspaceAccess(db, actorId, input.workspaceId, "WRITE");
  const title = requiredText(input.title, "title", 255);
  const equipmentType = requiredText(input.equipmentType, "equipmentType", 120);
  const assetTag = requiredText(input.assetTag, "assetTag", 120);
  const location = requiredText(input.location, "location", 200);
  const narrative = requiredText(input.narrative, "narrative", 20000);
  const id = newId();

  await db.transaction(async (tx) => {
    await tx.insert(investigations).values({
      id,
      workspaceId: input.workspaceId,
      ownerId: actorId,
      legacyCaseId: input.legacyCaseId ?? null,
      title,
      equipmentType,
      assetTag,
      location,
      narrative,
      severity: input.severity ?? null,
      status: input.status ?? "DRAFT",
      tagsSnapshot: input.tagsSnapshot ?? null,
      legacyData: input.legacyData ?? null,
    });
    await tx.insert(investigationMembers).values({
      id: newId(),
      investigationId: id,
      userId: actorId,
      permission: "RUN_AI",
      grantedBy: actorId,
    });
    await appendAuditEvent(tx, {
      workspaceId: input.workspaceId,
      actorId,
      investigationId: id,
      entityType: "investigation",
      entityId: id,
      action: "investigation.created",
      metadata: { legacyCaseId: input.legacyCaseId ?? null },
    });
  });

  return getInvestigation(actorId, id, "READ");
}

export async function getInvestigation(
  actorId: number,
  investigationId: string,
  permission: RepositoryPermission = "READ",
) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, permission);
  return access.investigation;
}

export async function listInvestigations(actorId: number, workspaceId: string) {
  const db = await requireDb();
  const membership = await requireWorkspaceAccess(db, actorId, workspaceId, "READ");
  const visibility = canAccessAllInvestigations(membership.membership.role)
    ? eq(investigations.workspaceId, workspaceId)
    : or(
      and(eq(investigations.workspaceId, workspaceId), eq(investigations.ownerId, actorId)),
      and(
        eq(investigations.workspaceId, workspaceId),
        inArray(
          investigations.id,
          db.select({ investigationId: investigationMembers.investigationId })
            .from(investigationMembers)
            .where(eq(investigationMembers.userId, actorId)),
        ),
      ),
    );
  return db
    .select()
    .from(investigations)
    .where(visibility)
    .orderBy(desc(investigations.updatedAt));
}

export async function updateInvestigation(
  actorId: number,
  investigationId: string,
  patch: Partial<Pick<InvestigationInput, "title" | "equipmentType" | "assetTag" | "location" | "narrative" | "severity" | "status" | "tagsSnapshot" | "legacyData">>,
) {
  const db = await requireDb();
  const current = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = requiredText(patch.title, "title", 255);
  if (patch.equipmentType !== undefined) update.equipmentType = requiredText(patch.equipmentType, "equipmentType", 120);
  if (patch.assetTag !== undefined) update.assetTag = requiredText(patch.assetTag, "assetTag", 120);
  if (patch.location !== undefined) update.location = requiredText(patch.location, "location", 200);
  if (patch.narrative !== undefined) update.narrative = requiredText(patch.narrative, "narrative", 20000);
  if (patch.severity !== undefined) update.severity = patch.severity;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.tagsSnapshot !== undefined) update.tagsSnapshot = patch.tagsSnapshot;
  if (patch.legacyData !== undefined) update.legacyData = patch.legacyData;
  if (Object.keys(update).length === 0) return current.investigation;

  await db.update(investigations).set(update).where(eq(investigations.id, investigationId));
  await appendAuditEvent(db, {
    workspaceId: current.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "investigation",
    entityId: investigationId,
    action: "investigation.updated",
    metadata: { fields: Object.keys(update) },
  });
  return getInvestigation(actorId, investigationId, "READ");
}

export async function deleteInvestigation(actorId: number, investigationId: string) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  if (access.workspaceMembership.role !== "ADMIN" && access.investigation.ownerId !== actorId) {
    throw new RepositoryError("FORBIDDEN", "Only the investigation owner or workspace admin can delete an investigation");
  }
  await db.transaction(async (tx) => {
    // Delete children explicitly because the existing foreign keys are intentionally non-cascading.
    await tx.delete(chatMessages).where(eq(chatMessages.investigationId, investigationId));
    await tx.delete(correctiveActions).where(eq(correctiveActions.investigationId, investigationId));
    await tx.delete(evidence).where(eq(evidence.investigationId, investigationId));
    await tx.delete(investigationMembers).where(eq(investigationMembers.investigationId, investigationId));
    await tx.delete(investigationTags).where(eq(investigationTags.investigationId, investigationId));
    await tx.delete(rcaResults).where(eq(rcaResults.investigationId, investigationId));
    await tx.delete(auditEvents).where(eq(auditEvents.investigationId, investigationId));
    await tx.delete(investigations).where(eq(investigations.id, investigationId));
  });
  return { investigationId, deleted: true };
}

export async function addInvestigationMember(
  actorId: number,
  investigationId: string,
  memberUserId: number,
  permission: "READ" | "WRITE" | "RUN_AI",
) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  if (access.workspaceMembership.role !== "ADMIN" && access.investigation.ownerId !== actorId) {
    throw new RepositoryError("FORBIDDEN", "Only workspace admins or investigation owners can grant access");
  }
  await assertUserExists(db, memberUserId);
  const existing = await db
    .select()
    .from(investigationMembers)
    .where(and(eq(investigationMembers.investigationId, investigationId), eq(investigationMembers.userId, memberUserId)))
    .limit(1);
  if (existing[0]) {
    await db.update(investigationMembers).set({ permission }).where(eq(investigationMembers.id, existing[0].id));
  } else {
    await db.insert(investigationMembers).values({
      id: newId(),
      investigationId,
      userId: memberUserId,
      permission,
      grantedBy: actorId,
    });
  }
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "investigation_member",
    entityId: investigationId,
    action: "investigation_member.granted",
    metadata: { targetUserId: memberUserId, permission },
  });
  return db.select().from(investigationMembers).where(and(eq(investigationMembers.investigationId, investigationId), eq(investigationMembers.userId, memberUserId))).limit(1).then((result) => result[0]);
}

export async function addEvidence(actorId: number, investigationId: string, input: EvidenceInput) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  const id = newId();
  await db.insert(evidence).values({
    id,
    investigationId,
    uploadedBy: actorId,
    objectKey: input.objectKey ?? null,
    kind: requiredText(input.kind, "kind", 32),
    name: requiredText(input.name, "name", 255),
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes ?? null,
    mediaHash: input.mediaHash ?? null,
    metadata: input.metadata ?? null,
    note: input.note ?? null,
    annotations: input.annotations ?? null,
  });
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "evidence",
    entityId: id,
    action: "evidence.created",
    metadata: { kind: input.kind, hasObjectKey: Boolean(input.objectKey), hasMediaHash: Boolean(input.mediaHash) },
  });
  return db.select().from(evidence).where(eq(evidence.id, id)).limit(1).then((result) => result[0]);
}

export async function listEvidence(actorId: number, investigationId: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db.select().from(evidence).where(eq(evidence.investigationId, investigationId)).orderBy(asc(evidence.createdAt));
}

export async function getEvidenceByObjectKey(actorId: number, objectKey: string) {
  const db = await requireDb();
  const rows = await db
    .select({ evidence, investigation: investigations })
    .from(evidence)
    .innerJoin(investigations, eq(evidence.investigationId, investigations.id))
    .where(eq(evidence.objectKey, objectKey))
    .limit(1);
  const row = rows[0];
  if (!row) throw new RepositoryError("NOT_FOUND", "Evidence not found");
  await getInvestigationForAccess(db, actorId, row.investigation.id, "READ");
  return row.evidence;
}

export async function getEvidenceById(actorId: number, evidenceId: string) {
  const db = await requireDb();
  const rows = await db
    .select({ evidence, investigation: investigations })
    .from(evidence)
    .innerJoin(investigations, eq(evidence.investigationId, investigations.id))
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new RepositoryError("NOT_FOUND", "Evidence not found");
  await getInvestigationForAccess(db, actorId, row.investigation.id, "READ");
  return row.evidence;
}

export async function findEvidenceByHash(actorId: number, investigationId: string, mediaHash: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db.select().from(evidence).where(and(eq(evidence.investigationId, investigationId), eq(evidence.mediaHash, mediaHash))).orderBy(desc(evidence.createdAt));
}

export async function saveRcaResult(actorId: number, investigationId: string, input: RcaResultInput) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "RUN_AI");
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.update(rcaResults).set({ isSuperseded: 1 }).where(and(eq(rcaResults.investigationId, investigationId), eq(rcaResults.isSuperseded, 0)));
    await tx.insert(rcaResults).values({
      id,
      investigationId,
      schemaVersion: requiredText(input.schemaVersion, "schemaVersion", 64),
      promptVersion: requiredText(input.promptVersion, "promptVersion", 64),
      validatorVersion: requiredText(input.validatorVersion, "validatorVersion", 64),
      validatedJson: input.validatedJson,
      provider: input.provider ?? null,
      modelId: input.modelId ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      costUsd: input.costUsd == null ? null : input.costUsd.toFixed(10),
      isSuperseded: 0,
      createdBy: actorId,
    });
    await tx.update(investigations).set({ status: "ANALYZED" }).where(eq(investigations.id, investigationId));
    await appendAuditEvent(tx, {
      workspaceId: access.investigation.workspaceId,
      actorId,
      investigationId,
      entityType: "rca_result",
      entityId: id,
      action: "rca_result.created",
      metadata: { provider: input.provider ?? null, modelId: input.modelId ?? null },
    });
  });
  return db.select().from(rcaResults).where(eq(rcaResults.id, id)).limit(1).then((result) => result[0]);
}

export async function getCurrentRcaResult(actorId: number, investigationId: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db.select().from(rcaResults).where(and(eq(rcaResults.investigationId, investigationId), eq(rcaResults.isSuperseded, 0))).orderBy(desc(rcaResults.createdAt)).limit(1).then((result) => result[0] ?? null);
}

export async function listRcaResults(actorId: number, investigationId: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db.select().from(rcaResults).where(eq(rcaResults.investigationId, investigationId)).orderBy(desc(rcaResults.createdAt));
}

export async function appendChatMessage(
  actorId: number,
  investigationId: string,
  input: { role: "USER" | "ASSISTANT" | "SYSTEM"; content: string; rcaResultId?: string | null },
) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  const content = requiredText(input.content, "content", 20000);
  const id = newId();
  await db.insert(chatMessages).values({
    id,
    investigationId,
    userId: actorId,
    role: input.role,
    content,
    rcaResultId: input.rcaResultId ?? null,
  });
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "chat_message",
    entityId: id,
    action: "chat_message.created",
    metadata: { role: input.role },
  });
  return db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1).then((result) => result[0]);
}

export async function listChatMessages(actorId: number, investigationId: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db.select().from(chatMessages).where(eq(chatMessages.investigationId, investigationId)).orderBy(asc(chatMessages.createdAt));
}

export async function createCorrectiveAction(
  actorId: number,
  investigationId: string,
  input: {
    description: string;
    reason?: string | null;
    specific?: string | null;
    measurable?: string | null;
    achievable?: string | null;
    relevant?: string | null;
    timeBound?: string | null;
    priority?: string | null;
    ownerId?: number | null;
    dueAt?: Date | null;
    rcaResultId?: string | null;
    kpi?: string | null;
  },
) {
  const db = await requireDb();
  const access = await getInvestigationForAccess(db, actorId, investigationId, "WRITE");
  const id = newId();
  await db.insert(correctiveActions).values({
    id,
    investigationId,
    rcaResultId: input.rcaResultId ?? null,
    description: requiredText(input.description, "description", 20000),
    reason: input.reason ?? null,
    specific: input.specific ?? null,
    measurable: input.measurable ?? null,
    achievable: input.achievable ?? null,
    relevant: input.relevant ?? null,
    timeBound: input.timeBound ?? null,
    priority: input.priority ?? null,
    ownerId: input.ownerId ?? null,
    dueAt: input.dueAt ?? null,
    status: "PLANNED",
    kpi: input.kpi ?? null,
    createdBy: actorId,
  });
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId,
    entityType: "corrective_action",
    entityId: id,
    action: "corrective_action.created",
    metadata: { ownerId: input.ownerId ?? null, priority: input.priority ?? null },
  });
  return db.select().from(correctiveActions).where(eq(correctiveActions.id, id)).limit(1).then((result) => result[0]);
}

export async function updateCorrectiveAction(
  actorId: number,
  actionId: string,
  patch: Partial<Pick<typeof correctiveActions.$inferInsert, "description" | "reason" | "specific" | "measurable" | "achievable" | "relevant" | "timeBound" | "priority" | "ownerId" | "dueAt" | "status" | "kpi">>,
) {
  const db = await requireDb();
  const rows = await db.select().from(correctiveActions).where(eq(correctiveActions.id, actionId)).limit(1);
  const current = rows[0];
  if (!current) throw new RepositoryError("NOT_FOUND", "Corrective action not found");
  const access = await getInvestigationForAccess(db, actorId, current.investigationId, "WRITE");
  await db.update(correctiveActions).set(patch).where(eq(correctiveActions.id, actionId));
  await appendAuditEvent(db, {
    workspaceId: access.investigation.workspaceId,
    actorId,
    investigationId: current.investigationId,
    entityType: "corrective_action",
    entityId: actionId,
    action: "corrective_action.updated",
    metadata: { fields: Object.keys(patch) },
  });
  return db.select().from(correctiveActions).where(eq(correctiveActions.id, actionId)).limit(1).then((result) => result[0]);
}

export async function listCorrectiveActions(actorId: number, investigationId: string) {
  const db = await requireDb();
  await getInvestigationForAccess(db, actorId, investigationId, "READ");
  return db.select().from(correctiveActions).where(eq(correctiveActions.investigationId, investigationId)).orderBy(asc(correctiveActions.createdAt));
}

export async function listInvestigationsByIds(actorId: number, workspaceId: string, ids: string[]) {
  const db = await requireDb();
  const membership = await requireWorkspaceAccess(db, actorId, workspaceId, "READ");
  if (ids.length === 0) return [];
  const visibility = canAccessAllInvestigations(membership.membership.role)
    ? eq(investigations.workspaceId, workspaceId)
    : or(
      and(eq(investigations.workspaceId, workspaceId), eq(investigations.ownerId, actorId)),
      and(
        eq(investigations.workspaceId, workspaceId),
        inArray(
          investigations.id,
          db.select({ investigationId: investigationMembers.investigationId })
            .from(investigationMembers)
            .where(eq(investigationMembers.userId, actorId)),
        ),
      ),
    );
  return db.select().from(investigations).where(and(visibility, inArray(investigations.id, ids)));
}
