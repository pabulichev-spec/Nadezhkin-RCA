import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { activeUserProcedure, router } from "./_core/trpc";
import {
  acceptWorkspaceInvitation,
  createWorkspace,
  createWorkspaceInvitation,
  findUsersForWorkspaceInvite,
  getWorkspaceForUser,
  listWorkspaceMembers,
  listWorkspacesForUser,
  setWorkspaceMemberRole,
  setWorkspaceMemberStatus,
} from "./repositories/workspaces";
import {
  addEvidence,
  addInvestigationMember,
  appendChatMessage,
  createCorrectiveAction,
  createInvestigation,
  deleteInvestigation,
  getCurrentRcaResult,
  getInvestigation,
  getEvidenceById,
  listChatMessages,
  listCorrectiveActions,
  listEvidence,
  listInvestigations,
  listRcaResults,
  saveRcaResult,
  updateCorrectiveAction,
  updateInvestigation,
} from "./repositories/investigations";
import {
  attachTag,
  createTag,
  detachTag,
  listAuditEvents,
  listInvestigationTags,
  listTags,
} from "./repositories/tags-audit";
import { RepositoryError } from "./repositories/common";
import { storagePut, storageGetSignedUrl } from "./storage";
import { runVideoAnalysis as runVideoAnalysisAgent } from "./ai/video-agent";

function mapRepositoryError(error: unknown): never {
  if (error instanceof RepositoryError) {
    const code = error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "FORBIDDEN" ? "FORBIDDEN" : error.code === "CONFLICT" ? "CONFLICT" : error.code === "VALIDATION" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
    throw new TRPCError({ code, message: error.message });
  }
  throw error;
}

async function repositoryCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return mapRepositoryError(error);
  }
}

const workspaceIdInput = z.object({ workspaceId: z.string().uuid() });
const investigationIdInput = z.object({ investigationId: z.string().uuid() });

export const workspaceRouter = router({
  list: activeUserProcedure.query(({ ctx }) => repositoryCall(() => listWorkspacesForUser(ctx.user.id))),
  get: activeUserProcedure.input(workspaceIdInput).query(({ ctx, input }) => repositoryCall(() => getWorkspaceForUser(ctx.user.id, input.workspaceId))),
  create: activeUserProcedure.input(z.object({ name: z.string().min(2).max(160) })).mutation(({ ctx, input }) => repositoryCall(() => createWorkspace(ctx.user.id, input))),
  members: activeUserProcedure.input(workspaceIdInput).query(({ ctx, input }) => repositoryCall(() => listWorkspaceMembers(ctx.user.id, input.workspaceId))),
  inviteCandidates: activeUserProcedure.input(workspaceIdInput.extend({ search: z.string().max(120) })).query(({ ctx, input }) => repositoryCall(() => findUsersForWorkspaceInvite(ctx.user.id, input.workspaceId, input.search))),
  invite: activeUserProcedure.input(z.object({
    workspaceId: z.string().uuid(),
    targetEmail: z.string().email().optional(),
    targetOpenId: z.string().max(64).optional(),
    role: z.enum(["MEMBER", "READER"]),
    expiresAt: z.coerce.date(),
  })).mutation(({ ctx, input }) => repositoryCall(() => createWorkspaceInvitation(ctx.user.id, input))),
  acceptInvitation: activeUserProcedure.input(z.object({ token: z.string().min(20).max(256) })).mutation(({ ctx, input }) => repositoryCall(() => acceptWorkspaceInvitation(ctx.user.id, input.token))),
  setMemberRole: activeUserProcedure.input(z.object({ workspaceId: z.string().uuid(), userId: z.number().int().positive(), role: z.enum(["ADMIN", "MEMBER", "READER"]) })).mutation(({ ctx, input }) => repositoryCall(() => setWorkspaceMemberRole(ctx.user.id, input.workspaceId, input.userId, input.role))),
  setMemberStatus: activeUserProcedure.input(z.object({ workspaceId: z.string().uuid(), userId: z.number().int().positive(), status: z.enum(["ACTIVE", "SUSPENDED"]) })).mutation(({ ctx, input }) => repositoryCall(() => setWorkspaceMemberStatus(ctx.user.id, input.workspaceId, input.userId, input.status))),
});

const investigationBase = z.object({
  workspaceId: z.string().uuid(),
  legacyCaseId: z.string().max(160).nullable().optional(),
  title: z.string().min(1).max(255),
  equipmentType: z.string().min(1).max(120),
  assetTag: z.string().min(1).max(120),
  location: z.string().min(1).max(200),
  narrative: z.string().min(1).max(20000),
  severity: z.string().max(32).nullable().optional(),
  status: z.string().max(48).optional(),
  tagsSnapshot: z.unknown().optional(),
  legacyData: z.unknown().optional(),
});

const evidenceInput = z.object({
  kind: z.string().min(1).max(32),
  name: z.string().min(1).max(255),
  objectKey: z.string().max(512).nullable().optional(),
  mimeType: z.string().max(160).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  mediaHash: z.string().max(128).nullable().optional(),
  metadata: z.unknown().optional(),
  note: z.string().max(20000).nullable().optional(),
  annotations: z.unknown().optional(),
});

const rcaResultInput = z.object({
  schemaVersion: z.string().min(1).max(64),
  promptVersion: z.string().min(1).max(64),
  validatorVersion: z.string().min(1).max(64),
  validatedJson: z.unknown(),
  provider: z.string().max(80).nullable().optional(),
  modelId: z.string().max(180).nullable().optional(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
});

export const investigationRouter = router({
  create: activeUserProcedure.input(investigationBase).mutation(({ ctx, input }) => repositoryCall(() => createInvestigation(ctx.user.id, input))),
  delete: activeUserProcedure.input(investigationIdInput).mutation(({ ctx, input }) => repositoryCall(() => deleteInvestigation(ctx.user.id, input.investigationId))),
  list: activeUserProcedure.input(workspaceIdInput).query(({ ctx, input }) => repositoryCall(() => listInvestigations(ctx.user.id, input.workspaceId))),
  get: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => getInvestigation(ctx.user.id, input.investigationId))),
  update: activeUserProcedure.input(investigationIdInput.extend({ patch: investigationBase.partial().omit({ workspaceId: true }) })).mutation(({ ctx, input }) => repositoryCall(() => updateInvestigation(ctx.user.id, input.investigationId, input.patch))),
  addMember: activeUserProcedure.input(z.object({ investigationId: z.string().uuid(), userId: z.number().int().positive(), permission: z.enum(["READ", "WRITE", "RUN_AI"]) })).mutation(({ ctx, input }) => repositoryCall(() => addInvestigationMember(ctx.user.id, input.investigationId, input.userId, input.permission))),
  addEvidence: activeUserProcedure.input(investigationIdInput.extend({ evidence: evidenceInput })).mutation(({ ctx, input }) => repositoryCall(() => addEvidence(ctx.user.id, input.investigationId, input.evidence))),
  evidence: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => listEvidence(ctx.user.id, input.investigationId))),
  uploadEvidence: activeUserProcedure.input(investigationIdInput.extend({
    file: z.object({
      name: z.string().min(1).max(255),
      mimeType: z.string().max(160).default("application/octet-stream"),
      base64: z.string().min(1).max(14_000_000),
      kind: z.string().min(1).max(32),
      note: z.string().max(20_000).nullable().optional(),
      mediaHash: z.string().max(128).nullable().optional(),
      metadata: z.unknown().optional(),
      annotations: z.unknown().optional(),
    }),
  })).mutation(({ ctx, input }) => repositoryCall(async () => {
    const access = await getInvestigation(ctx.user.id, input.investigationId, "WRITE");
    const buffer = Buffer.from(input.file.base64, "base64");
    if (buffer.length > 10 * 1024 * 1024) throw new RepositoryError("VALIDATION", "Evidence file exceeds 10 MB upload limit");
    const objectPath = `pumprca/${access.workspaceId}/${input.investigationId}/${input.file.name}`;
    const uploaded = await storagePut(objectPath, buffer, input.file.mimeType);
    return addEvidence(ctx.user.id, input.investigationId, {
      kind: input.file.kind,
      name: input.file.name,
      objectKey: uploaded.key,
      mimeType: input.file.mimeType,
      sizeBytes: buffer.length,
      mediaHash: input.file.mediaHash,
      metadata: input.file.metadata,
      note: input.file.note,
      annotations: input.file.annotations,
    });
  })),
  signedEvidenceUrl: activeUserProcedure.input(z.object({ evidenceId: z.string().uuid() })).query(({ ctx, input }) => repositoryCall(async () => {
    const evidenceItem = await getEvidenceById(ctx.user.id, input.evidenceId);
    if (!evidenceItem?.objectKey) throw new RepositoryError("NOT_FOUND", "Evidence file is unavailable");
    return { url: await storageGetSignedUrl(evidenceItem.objectKey), expiresInSeconds: 300 };
  })),
  runVideoAnalysis: activeUserProcedure.input(z.object({
    investigationId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    frames: z.array(z.object({
      timestampMs: z.number().int().nonnegative(),
      imageData: z.string().max(7_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/i),
      note: z.string().max(2000).optional(),
    })).min(1).max(20).superRefine((frames, ctx) => {
      const totalBytes = frames.reduce((total, frame) => total + frame.imageData.length, 0);
      if (totalBytes > 24_000_000) ctx.addIssue({ code: "custom", message: "Video frames exceed the 24 MB analysis limit." });
    }),
  })).mutation(({ ctx, input }) => repositoryCall(async () => {
    await getInvestigation(ctx.user.id, input.investigationId, "RUN_AI");
    const evidenceItem = await getEvidenceById(ctx.user.id, input.evidenceId);
    if (evidenceItem.investigationId !== input.investigationId) throw new RepositoryError("NOT_FOUND", "Evidence not found");
    if (evidenceItem.kind !== "video") throw new RepositoryError("VALIDATION", "Selected evidence is not a video");
    const response = await runVideoAnalysisAgent(input.frames.map((frame) => ({
      evidenceRef: evidenceItem.name,
      timestampMs: frame.timestampMs,
      imageData: frame.imageData,
      note: frame.note,
    })));
    return {
      analysis: JSON.parse(response.content),
      provider: response.provider,
      model: response.model,
      usage: response.usage,
    };
  })),
  saveRcaResult: activeUserProcedure.input(investigationIdInput.extend({ result: rcaResultInput })).mutation(({ ctx, input }) => repositoryCall(() => saveRcaResult(ctx.user.id, input.investigationId, input.result))),
  currentRcaResult: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => getCurrentRcaResult(ctx.user.id, input.investigationId))),
  rcaResults: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => listRcaResults(ctx.user.id, input.investigationId))),
  chat: router({
    list: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => listChatMessages(ctx.user.id, input.investigationId))),
    append: activeUserProcedure.input(investigationIdInput.extend({ message: z.object({ role: z.enum(["USER", "ASSISTANT", "SYSTEM"]), content: z.string().min(1).max(20000), rcaResultId: z.string().uuid().nullable().optional() }) })).mutation(({ ctx, input }) => repositoryCall(() => appendChatMessage(ctx.user.id, input.investigationId, input.message))),
  }),
  actions: router({
    list: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => listCorrectiveActions(ctx.user.id, input.investigationId))),
    create: activeUserProcedure.input(investigationIdInput.extend({ action: z.object({
      description: z.string().min(1).max(20000),
      reason: z.string().max(20000).nullable().optional(),
      specific: z.string().max(20000).nullable().optional(),
      measurable: z.string().max(20000).nullable().optional(),
      achievable: z.string().max(20000).nullable().optional(),
      relevant: z.string().max(20000).nullable().optional(),
      timeBound: z.string().max(20000).nullable().optional(),
      priority: z.string().max(32).nullable().optional(),
      ownerId: z.number().int().positive().nullable().optional(),
      dueAt: z.coerce.date().nullable().optional(),
      rcaResultId: z.string().uuid().nullable().optional(),
      kpi: z.string().max(20000).nullable().optional(),
    }) })).mutation(({ ctx, input }) => repositoryCall(() => createCorrectiveAction(ctx.user.id, input.investigationId, input.action))),
    update: activeUserProcedure.input(z.object({ actionId: z.string().uuid(), patch: z.object({
      description: z.string().min(1).max(20000).optional(),
      reason: z.string().max(20000).nullable().optional(),
      specific: z.string().max(20000).nullable().optional(),
      measurable: z.string().max(20000).nullable().optional(),
      achievable: z.string().max(20000).nullable().optional(),
      relevant: z.string().max(20000).nullable().optional(),
      timeBound: z.string().max(20000).nullable().optional(),
      priority: z.string().max(32).nullable().optional(),
      ownerId: z.number().int().positive().nullable().optional(),
      dueAt: z.coerce.date().nullable().optional(),
      status: z.enum(["PLANNED", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
      kpi: z.string().max(20000).nullable().optional(),
    }) })).mutation(({ ctx, input }) => repositoryCall(() => updateCorrectiveAction(ctx.user.id, input.actionId, input.patch))),
  }),
});

export const tagRouter = router({
  create: activeUserProcedure.input(z.object({ workspaceId: z.string().uuid(), name: z.string().min(1).max(120) })).mutation(({ ctx, input }) => repositoryCall(() => createTag(ctx.user.id, input.workspaceId, input.name))),
  list: activeUserProcedure.input(workspaceIdInput).query(({ ctx, input }) => repositoryCall(() => listTags(ctx.user.id, input.workspaceId))),
  attach: activeUserProcedure.input(z.object({ investigationId: z.string().uuid(), tagId: z.string().uuid() })).mutation(({ ctx, input }) => repositoryCall(() => attachTag(ctx.user.id, input.investigationId, input.tagId))),
  detach: activeUserProcedure.input(z.object({ investigationId: z.string().uuid(), tagId: z.string().uuid() })).mutation(({ ctx, input }) => repositoryCall(() => detachTag(ctx.user.id, input.investigationId, input.tagId))),
  forInvestigation: activeUserProcedure.input(investigationIdInput).query(({ ctx, input }) => repositoryCall(() => listInvestigationTags(ctx.user.id, input.investigationId))),
});

export const auditRouter = router({
  list: activeUserProcedure.input(z.object({ workspaceId: z.string().uuid(), investigationId: z.string().uuid().optional(), limit: z.number().int().positive().max(500).optional() })).query(({ ctx, input }) => repositoryCall(() => listAuditEvents(ctx.user.id, input))),
});
