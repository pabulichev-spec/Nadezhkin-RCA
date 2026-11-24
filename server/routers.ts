import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { getAiGatewayStatus, runAiGateway } from "./ai/gateway";
import { listFreeModels } from "./ai/model-registry";
import { systemRouter } from "./_core/systemRouter";
import { activeUserProcedure, adminProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { formatRcaEvidence } from "../shared/rca";
import { buildRcaChatPrompt } from "../shared/chat";
import { normalizeAndValidateRca } from "./ai/rca-validator";
import { incrementUserSessionVersion, listUsers, setUserRole, setUserStatus } from "./db";
import { auditRouter, investigationRouter, tagRouter, workspaceRouter } from "./routers-stage3c";
import { appendChatMessage, getInvestigation, saveRcaResult } from "./repositories/investigations";
import { runRcaOrchestrator } from "./ai/rca-orchestrator";
import { createRcaCorrelationId, createRcaErrorEnvelopeCause, logRcaEvent, RcaPipelineError, type RcaPipelineStage } from "./ai/rca-diagnostics";
import { AiGatewayError } from "./ai/types";

function rcaErrorCode(error: unknown): "BAD_REQUEST" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR" {
  const cause = error instanceof RcaPipelineError ? error.cause : error;
  if (cause instanceof AiGatewayError && cause.code === "FREE_QUOTA_EXCEEDED") return "TOO_MANY_REQUESTS";
  if (cause instanceof AiGatewayError && cause.code === "INVALID_AI_RESPONSE") return "BAD_REQUEST";
  return "INTERNAL_SERVER_ERROR";
}

function throwRcaPipelineError(error: unknown, correlationId: string, stage: RcaPipelineStage): never {
  const pipeline = error instanceof RcaPipelineError ? error : undefined;
  const cause = pipeline?.cause ?? error;
  logRcaEvent({ correlationId, stage, outcome: "failed", error: cause });
  const code = rcaErrorCode(error);
  const detail = cause instanceof AiGatewayError && cause.code === "FREE_QUOTA_EXCEEDED"
    ? "Бесплатная AI-квота временно исчерпана."
    : cause instanceof AiGatewayError && cause.code === "INVALID_AI_RESPONSE"
      ? "Бесплатная AI-модель вернула несовместимый структурированный ответ."
      : "Сервер не смог завершить RCA-анализ.";
  throw new TRPCError({
    code,
    message: `${detail} Этап: ${pipeline?.stage ?? stage}.`,
    cause: createRcaErrorEnvelopeCause(pipeline?.stage ?? stage, correlationId),
  });
}

const evidenceSchema = z.object({
  kind: z.enum(["photo", "video", "text", "file"]),
  name: z.string().max(200),
  note: z.string().max(2000).optional(),
  imageData: z.string().max(7_000_000).optional(),
  fileData: z.string().max(8_000_000).optional(),
  mimeType: z.string().max(120).optional(),
  sourceName: z.string().max(200).optional(),
  timestampMs: z.number().int().nonnegative().optional(),
});

const rcaOutputSchema = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    physicalCause: { type: "string" },
    humanFactor: { type: "string" },
    systemicCause: { type: "string" },
    smartActions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string" },
          specific: { type: "string" },
          measurable: { type: "string" },
          achievable: { type: "string" },
          relevant: { type: "string" },
          timeBound: { type: "string" },
        },
        required: ["priority", "specific", "measurable", "achievable", "relevant", "timeBound"],
        additionalProperties: false,
      },
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    openQuestions: { type: "array", items: { type: "string" } },
    methodNotes: { type: "string" },
    structuredRca: {
      type: "object",
      properties: {
        facts: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, source: { type: "string", enum: ["USER_PROVIDED", "MEASURED", "MEDIA_OBSERVED", "DOCUMENTED", "UNKNOWN"] }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "source", "evidenceRefs"], additionalProperties: false } },
        symptoms: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "evidenceRefs"], additionalProperties: false } },
        hypotheses: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, supportingFactIndexes: { type: "array", items: { type: "integer", minimum: 0 } }, confidence: { type: "integer", minimum: 0, maximum: 100 }, status: { type: "string", enum: ["OPEN", "SUPPORTED", "CONFIRMED", "REJECTED", "INSUFFICIENT_DATA"] } }, required: ["statement", "supportingFactIndexes", "confidence", "status"], additionalProperties: false } },
        missingData: { type: "array", items: { type: "string" } },
      },
      required: ["facts", "symptoms", "hypotheses", "missingData"],
      additionalProperties: false,
    },
  },
  required: [
    "executiveSummary",
    "physicalCause",
    "humanFactor",
    "systemicCause",
    "smartActions",
    "confidence",
    "openQuestions",
    "methodNotes",
    "structuredRca",
  ],
  additionalProperties: false,
} as const;

export const appRouter = router({
  system: systemRouter,
  workspace: workspaceRouter,
  investigation: investigationRouter,
  tag: tagRouter,
  audit: auditRouter,
  ai: router({
    status: publicProcedure.query(() => getAiGatewayStatus()),
    models: publicProcedure.query(async () => (await listFreeModels()).map((model) => ({
      id: model.id,
      name: model.name,
      free: model.free,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      supportedParameters: model.supportedParameters,
      contextWindow: model.contextWindow,
      pricing: model.pricing,
    }))),
  }),
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user ? {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      loginMethod: ctx.user.loginMethod,
      role: ctx.user.role,
      status: ctx.user.status,
      lastSignedIn: ctx.user.lastSignedIn,
    } : null),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.user) await incrementUserSessionVersion(ctx.user.id);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  admin: router({
    users: adminProcedure.query(() => listUsers()),
    setUserStatus: adminProcedure
      .input(z.object({ userId: z.number().int().positive(), status: z.enum(["pending", "active", "disabled"]) }))
      .mutation(({ input }) => setUserStatus(input.userId, input.status).then(() => ({ success: true as const }))),
    setUserRole: adminProcedure
      .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]) }))
      .mutation(({ input }) => setUserRole(input.userId, input.role).then(() => ({ success: true as const }))),
  }),
  rca: router({
    ask: activeUserProcedure
      .input(z.object({
        investigationId: z.string().uuid().optional(),
        caseTitle: z.string().min(1).max(255),
        equipmentType: z.string().max(120),
        assetTag: z.string().max(120),
        location: z.string().max(200),
        narrative: z.string().max(8000),
        result: z.object({
          executiveSummary: z.string().max(6000),
          physicalCause: z.string().max(3000),
          humanFactor: z.string().max(3000),
          systemicCause: z.string().max(3000),
          smartActions: z.array(z.object({ priority: z.string().max(20), specific: z.string().max(1000), measurable: z.string().max(1000), achievable: z.string().max(1000), relevant: z.string().max(1000), timeBound: z.string().max(200) })).max(20),
          confidence: z.number().min(0).max(100),
          openQuestions: z.array(z.string().max(1000)).max(20),
          methodNotes: z.string().max(3000),
          structuredRca: z.object({
            facts: z.array(z.object({ statement: z.string().max(2000), source: z.enum(["USER_PROVIDED", "MEASURED", "MEDIA_OBSERVED", "DOCUMENTED", "UNKNOWN"]), evidenceRefs: z.array(z.string().max(200)).max(20) })).max(50),
            symptoms: z.array(z.object({ statement: z.string().max(2000), evidenceRefs: z.array(z.string().max(200)).max(20) })).max(50),
            hypotheses: z.array(z.object({ statement: z.string().max(2000), supportingFactIndexes: z.array(z.number().int().min(0)).max(50), confidence: z.number().int().min(0).max(100), status: z.enum(["OPEN", "SUPPORTED", "CONFIRMED", "REJECTED", "INSUFFICIENT_DATA"]) })).max(50),
            missingData: z.array(z.string().max(1000)).max(50),
          }),
        }),
        evidence: z.array(z.object({ kind: z.string().max(30), name: z.string().max(200), note: z.string().max(2000).optional() })).max(12),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12),
        question: z.string().min(1).max(2000),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.investigationId) await getInvestigation(ctx.user.id, input.investigationId, "RUN_AI");
        const prompt = buildRcaChatPrompt({ ...input, history: [...input.history, { role: "user", content: input.question }] });
        const response = await runAiGateway({
          task: "CHAT",
          messages: [
            { role: "system", content: "Ты — инженер по надёжности насосного оборудования, отвечающий на вопросы по существующему RCA-отчёту. Отвечай на русском языке." },
            { role: "user", content: prompt },
          ],
          maxTokens: 1600,
        });
        if (input.investigationId) {
          await appendChatMessage(ctx.user.id, input.investigationId, { role: "USER", content: input.question });
          await appendChatMessage(ctx.user.id, input.investigationId, { role: "ASSISTANT", content: response.content });
        }
        return { answer: response.content, provider: response.provider, model: response.model, usage: response.usage };
      }),
    analyze: activeUserProcedure
      .input(z.object({
        investigationId: z.string().uuid().optional(),
        caseTitle: z.string().min(1).max(255),
        equipmentType: z.string().max(120),
        assetTag: z.string().max(120),
        location: z.string().max(200),
        narrative: z.string().max(8000),
        evidence: z.array(evidenceSchema).max(30).superRefine((items, ctx) => {
          const videoFrames = items.filter((item) => item.kind === "video");
          const photos = items.filter((item) => item.kind === "photo" && item.imageData);
          if (photos.length > 10) ctx.addIssue({ code: "custom", message: "A maximum of 10 photos can be analyzed in one RCA run." });
          const totalPhotoBytes = photos.reduce((total, item) => total + (item.imageData?.length ?? 0), 0);
          if (totalPhotoBytes > 24_000_000) ctx.addIssue({ code: "custom", message: "Photos exceed the combined 24 MB analysis limit." });
          if (videoFrames.length > 20) ctx.addIssue({ code: "custom", message: "A maximum of 20 extracted video frames is allowed." });
          if (videoFrames.some((item) => !item.imageData || item.timestampMs === undefined)) {
            ctx.addIssue({ code: "custom", message: "Every video frame must include image data and a timestamp." });
          }
          const totalFrameBytes = videoFrames.reduce((total, item) => total + (item.imageData?.length ?? 0), 0);
          if (totalFrameBytes > 24_000_000) ctx.addIssue({ code: "custom", message: "Video frames exceed the 24 MB analysis limit." });
          const documents = items.filter((item) => item.kind === "file" && item.fileData);
          if (documents.length > 10) ctx.addIssue({ code: "custom", message: "A maximum of 10 documents can be analyzed in one RCA run." });
          const totalDocumentBytes = documents.reduce((total, item) => total + Math.floor((item.fileData?.length ?? 0) * 0.75), 0);
          if (totalDocumentBytes > 15_000_000) ctx.addIssue({ code: "custom", message: "Documents exceed the combined 15 MB analysis limit." });
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.investigationId) await getInvestigation(ctx.user.id, input.investigationId, "RUN_AI");
        const correlationId = createRcaCorrelationId();
        const evidenceText = input.evidence.map((item, index) => {
          return `${index + 1}. ${formatRcaEvidence(item.kind, item.name, item.note)}`;
        }).join("\n");

        const allowedEvidenceRefs = [...new Set(input.evidence.flatMap((item) => [item.name, ...(item.sourceName ? [item.sourceName] : [])])) , "narrative", "case narrative"];
        const content: any[] = [{
          type: "text",
          text: `Сделай предварительный RCA отказа насоса. Ответь по-русски и верни только JSON по схеме.
Кейс:${input.caseTitle}; оборудование:${input.equipmentType}; актив:${input.assetTag}; локация:${input.location}
Событие:${input.narrative}
Материалы:${evidenceText || "нет"}
Требования: верни structuredRca с четырьмя массивами facts, symptoms, hypotheses, missingData. Каждый факт обязан иметь statement, source и evidenceRefs; каждая гипотеза обязана ссылаться на один или более существующих facts через supportingFactIndexes. Не выдавай гипотезу за факт и не выдумывай evidenceRefs.
Допустимые evidenceRefs — только точные имена входных материалов из этого списка: ${JSON.stringify(allowedEvidenceRefs)}. Если отдельного материала нет, используй только "narrative" или "case narrative". Никогда не создавай идентификаторы вроде "operator_statement", "photo_1" или "measurement_sheet".
Неизвестное указывай в missingData. Дополнительно заполни legacy-блоки physicalCause, humanFactor, systemicCause и smartActions для обратной совместимости. В каждом smartActions обязательны specific/measurable/achievable/relevant/timeBound. При нехватке данных снизь confidence и добавь openQuestions. В methodNotes укажи ограничения и что должен проверить инженер.`,
        }];

        try {
          const photoImages = input.evidence
            .filter((item) => item.kind === "photo" && item.imageData)
            .map((item) => ({ evidenceRef: item.sourceName ?? item.name, imageData: item.imageData!, note: item.note }));
          const videoFrames = input.evidence
            .filter((item) => item.kind === "video" && item.imageData)
            .map((item) => ({ evidenceRef: item.sourceName ?? item.name, timestampMs: item.timestampMs ?? 0, imageData: item.imageData!, note: item.note }));
          const documentFiles = input.evidence
            .filter((item) => item.kind === "file" && item.fileData && item.mimeType)
            .map((item) => ({ evidenceRef: item.name, mimeType: item.mimeType!, fileData: item.fileData!, note: item.note }));
          const response = await runRcaOrchestrator({
            task: "RCA",
            photoImages,
            videoFrames,
            documentFiles,
              messages: [
                { role: "system", content: "Ты — опытный инженер по надёжности насосного оборудования и фасилитатор RCA. Будь строгим к доказательствам, не выдумывай измерения и марки материалов. Верни только объект JSON; structuredRca обязателен. FACT — только явно предоставленное, измеренное, документированное или реально наблюдаемое; HYPOTHESIS — только со ссылками supportingFactIndexes; неизвестное помещай в MISSING_DATA. physicalCause, humanFactor и systemicCause должны быть непустыми строками, smartActions должны иметь непустые priority/specific/measurable/achievable/relevant/timeBound, confidence — целое 0-100." },
                { role: "user", content },
              ],
              reasoning: { effort: "medium" },
              maxTokens: 5000,
              responseFormat: {
                type: "json_schema",
                json_schema: { name: "pump_rca_result", strict: true, schema: rcaOutputSchema },
              },
          }, allowedEvidenceRefs, { correlationId });
          const validated = normalizeAndValidateRca(response.content, { knownEvidenceRefs: allowedEvidenceRefs });
          if (input.investigationId) {
            try {
              await saveRcaResult(ctx.user.id, input.investigationId, {
                schemaVersion: "rca-schema-v2",
                promptVersion: "rca-prompt-v2",
                validatorVersion: "rca-validator-v3",
                validatedJson: validated,
                provider: response.provider,
                modelId: response.model,
                inputTokens: response.usage.promptTokens ?? null,
                outputTokens: response.usage.completionTokens ?? null,
                costUsd: response.usage.cost,
              });
            } catch (error) {
              throw new RcaPipelineError("save", correlationId, error);
            }
              }
          return validated;
        } catch (error) {
          throwRcaPipelineError(error, correlationId, error instanceof RcaPipelineError ? error.stage : "validation");
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
