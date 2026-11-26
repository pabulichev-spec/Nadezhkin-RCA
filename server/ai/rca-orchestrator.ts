import { ENV } from "../_core/env";
import { normalizeAndValidateRca, parseJsonPayload } from "./rca-validator";
import { callFreeProvider } from "./provider-router";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";
import { allowlistedModelIds, type FreeAgentRole } from "./free-allowlist";
import { createRcaCorrelationId, logRcaEvent, RcaPipelineError } from "./rca-diagnostics";
import { runVideoAnalysis, type VideoFrameInput } from "./video-agent";
import { runPhotoAnalysis, type PhotoInput } from "./photo-agent";
import { runDocumentAnalysis, type DocumentInput } from "./document-agent";
import { runTechnicalExpertAnalysis } from "./technical-expert-agent";

type AgentFinding = {
  facts: Array<{ statement: string; source: string; evidenceRefs: string[] }>;
  symptoms: Array<{ statement: string; evidenceRefs: string[] }>;
  hypotheses: Array<{ statement: string; supportingFactIndexes: number[]; confidence: number; status: string }>;
  missingData: string[];
};

const agentFormat = (name: string) => ({
  type: "json_schema",
  json_schema: {
    name,
    strict: true,
    schema: {
      type: "object",
      properties: {
        facts: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, source: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "source", "evidenceRefs"], additionalProperties: false } },
        symptoms: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "evidenceRefs"], additionalProperties: false } },
        hypotheses: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, supportingFactIndexes: { type: "array", items: { type: "integer" } }, confidence: { type: "integer", minimum: 0, maximum: 100 }, status: { type: "string" } }, required: ["statement", "supportingFactIndexes", "confidence", "status"], additionalProperties: false } },
        missingData: { type: "array", items: { type: "string" } },
      },
      required: ["facts", "symptoms", "hypotheses", "missingData"],
      additionalProperties: false,
    },
  },
});

const composerFormat = () => ({
  type: "json_schema",
  json_schema: {
    name: "pump_rca_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        executiveSummary: { type: "string" },
        physicalCause: { type: "string" },
        humanFactor: { type: "string" },
        systemicCause: { type: "string" },
        smartActions: { type: "array", items: { type: "object", properties: {
          priority: { type: "string" }, specific: { type: "string" }, measurable: { type: "string" },
          achievable: { type: "string" }, relevant: { type: "string" }, timeBound: { type: "string" },
        }, required: ["priority", "specific", "measurable", "achievable", "relevant", "timeBound"], additionalProperties: false } },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        openQuestions: { type: "array", items: { type: "string" } },
        methodNotes: { type: "string" },
        structuredRca: { type: "object", properties: {
          facts: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, source: { type: "string", enum: ["USER_PROVIDED", "MEASURED", "MEDIA_OBSERVED", "DOCUMENTED", "UNKNOWN"] }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "source", "evidenceRefs"], additionalProperties: false } },
          symptoms: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "evidenceRefs"], additionalProperties: false } },
          hypotheses: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, supportingFactIndexes: { type: "array", items: { type: "integer", minimum: 0 } }, confidence: { type: "integer", minimum: 0, maximum: 100 }, status: { type: "string", enum: ["OPEN", "SUPPORTED", "CONFIRMED", "REJECTED", "INSUFFICIENT_DATA"] } }, required: ["statement", "supportingFactIndexes", "confidence", "status"], additionalProperties: false } },
          missingData: { type: "array", items: { type: "string" } },
        }, required: ["facts", "symptoms", "hypotheses", "missingData"], additionalProperties: false },
      },
      required: ["executiveSummary", "physicalCause", "humanFactor", "systemicCause", "smartActions", "confidence", "openQuestions", "methodNotes", "structuredRca"],
      additionalProperties: false,
    },
  },
});

function parseFinding(content: string): AgentFinding {
  try {
    const raw = parseJsonPayload(content) as Record<string, unknown>;
    const parsed = raw && typeof raw === "object" ? {
      ...raw,
      facts: raw.facts,
      symptoms: raw.symptoms,
      hypotheses: raw.hypotheses,
      missingData: raw.missingData ?? raw.missing_data,
    } as AgentFinding : raw as AgentFinding;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.facts) || !Array.isArray(parsed.symptoms) || !Array.isArray(parsed.hypotheses) || !Array.isArray(parsed.missingData)) {
      throw new Error("agent finding schema mismatch");
    }
    return parsed;
  } catch {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "RCA agent returned invalid JSON.");
  }
}

async function runFindingAgent(
  provider: (request: AiRequest) => Promise<AiResponse>,
  request: AiRequest,
  stage: "analyst" | "critic",
  correlationId: string,
) {
  let currentRequest = request;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await runAgent(provider, currentRequest, stage, correlationId);
    try {
      return { response, finding: parseFinding(response.content) };
    } catch (error) {
      lastError = error;
      logRcaEvent({ correlationId, stage: "validation", outcome: "failed", error });
      if (attempt === 1) break;
      currentRequest = {
        ...currentRequest,
        model: undefined,
        excludeModels: [...new Set([...(currentRequest.excludeModels ?? []), currentRequest.model, response.model].filter((model): model is string => Boolean(model)))],
        messages: [
          ...currentRequest.messages,
          { role: "system", content: "Предыдущий ответ был несовместим: верни только корректный JSON строго по указанной схеме, без markdown и пояснений." },
        ],
      };
    }
  }
  throw new RcaPipelineError("validation", correlationId, lastError ?? new AiGatewayError("INVALID_AI_RESPONSE", "RCA agent returned an incompatible structured response."));
}

function agentRequest(base: AiRequest, role: FreeAgentRole, system: string, user: string, responseFormat: Record<string, unknown>): AiRequest {
  return { ...base, task: "RCA", agentRole: role, model: allowlistedModelIds(role)[0], messages: [...base.messages, { role: "system", content: system }, { role: "user", content: user }], responseFormat, reasoning: { enabled: false }, maxTokens: Math.min(base.maxTokens ?? 5000, 1800) };
}

function textOnlyRequest(base: AiRequest): AiRequest {
  return {
    ...base,
    messages: base.messages.map((message) => {
      if (!Array.isArray(message.content)) return message;
      const textParts = message.content.filter((part) => part.type === "text");
      return { ...message, content: textParts.length ? textParts : "" };
    }),
  };
}

function technicalExpertUnavailableFinding(knownEvidenceRefs: string[]) {
  return JSON.stringify({
    equipmentAssessment: "Technical Expert временно недоступен: бесплатные AI-маршруты не вернули совместимый ответ. Техническая причина не установлена.",
    technicalFacts: [],
    failureMechanisms: [],
    diagnosticChecks: [{
      check: "Повторить техническую экспертизу после восстановления доступности бесплатного AI-маршрута.",
      purpose: "Получить инженерную интерпретацию без подмены отсутствующих данных гипотезой.",
      method: "Повторный запуск RCA после проверки доступности разрешённого zero-cost пула.",
      priority: "HIGH",
    }],
    requiredMeasurements: [{
      parameter: "Фактические параметры отказа и режим работы оборудования",
      why: "Technical Expert не смог проверить инженерные данные.",
      conditions: "Собрать по утверждённой процедуре с безопасной изоляцией энергии.",
    }],
    missingTechnicalData: [
      "Техническая интерпретация AI не получена из-за временной недоступности бесплатного маршрута.",
      ...(knownEvidenceRefs.length ? [] : ["Нет разрешённых ссылок на исходные доказательства."]),
    ],
    safetyPrecautions: ["Не считать гипотезу подтверждённой причиной; не выполнять опасные работы без утверждённой процедуры и изоляции энергии."],
    confidence: 0,
  });
}

async function runAgent(provider: (request: AiRequest) => Promise<AiResponse>, request: AiRequest, stage: "analyst" | "critic" | "composer", correlationId: string) {
  logRcaEvent({ correlationId, stage, outcome: "started" });
  try {
    const response = await provider(request);
    logRcaEvent({ correlationId, stage, outcome: "succeeded", response });
    return response;
  } catch (error) {
    logRcaEvent({ correlationId, stage, outcome: "failed", error });
    throw new RcaPipelineError(stage, correlationId, error);
  }
}

export async function runRcaOrchestrator(
  base: AiRequest,
  knownEvidenceRefs: string[],
  options?: { enabled?: boolean; provider?: typeof callFreeProvider; correlationId?: string; technicalExpertEnabled?: boolean },
): Promise<AiResponse> {
  const provider = options?.provider ?? callFreeProvider;
  const correlationId = options?.correlationId ?? createRcaCorrelationId();
  const { photoImages = [], videoFrames = [], documentFiles = [], ...baseRequest } = base;
  let enrichedBase: AiRequest = baseRequest;

  if (photoImages.length) {
    logRcaEvent({ correlationId, stage: "photo", outcome: "started" });
    try {
      const photoResponse = await runPhotoAnalysis(photoImages as PhotoInput[], provider);
      logRcaEvent({ correlationId, stage: "photo", outcome: "succeeded", response: photoResponse });
      enrichedBase = {
        ...enrichedBase,
        messages: [...enrichedBase.messages, {
          role: "user",
          content: `РЕЗУЛЬТАТ ОТДЕЛЬНОГО PHOTO AGENT (визуальные наблюдения; не подтверждённые причины):\n${photoResponse.content}`,
        }],
      };
    } catch (error) {
      logRcaEvent({ correlationId, stage: "photo", outcome: "failed", error });
      throw new RcaPipelineError("photo", correlationId, error);
    }
  }

  if (videoFrames.length) {
    logRcaEvent({ correlationId, stage: "video", outcome: "started" });
    try {
      const videoResponse = await runVideoAnalysis(videoFrames as VideoFrameInput[], provider);
      logRcaEvent({ correlationId, stage: "video", outcome: "succeeded", response: videoResponse });
      enrichedBase = {
        ...enrichedBase,
        messages: [...enrichedBase.messages, {
          role: "user",
          content: `РЕЗУЛЬТАТ ОТДЕЛЬНОГО VIDEO AGENT (наблюдения по извлечённым кадрам; не подтверждённые причины):\n${videoResponse.content}`,
        }],
      };
    } catch (error) {
      logRcaEvent({ correlationId, stage: "video", outcome: "failed", error });
      throw new RcaPipelineError("video", correlationId, error);
    }
  }

  if (documentFiles.length) {
    logRcaEvent({ correlationId, stage: "document", outcome: "started" });
    try {
      const documentResponse = await runDocumentAnalysis(documentFiles as DocumentInput[], provider);
      logRcaEvent({ correlationId, stage: "document", outcome: "succeeded", response: documentResponse });
      enrichedBase = {
        ...enrichedBase,
        messages: [...enrichedBase.messages, {
          role: "user",
          content: `РЕЗУЛЬТАТ ОТДЕЛЬНОГО DOCUMENT AGENT (извлечённые сведения из документов; не подтверждённые причины):\n${documentResponse.content}`,
        }],
      };
    } catch (error) {
      logRcaEvent({ correlationId, stage: "document", outcome: "failed", error });
      throw new RcaPipelineError("document", correlationId, error);
    }
  }

  if (!(options?.enabled ?? ENV.multiAgentEnabled)) return provider(enrichedBase);

  if (options?.technicalExpertEnabled ?? true) {
    logRcaEvent({ correlationId, stage: "technical", outcome: "started" });
    try {
      const technicalResponse = await runTechnicalExpertAnalysis(enrichedBase.messages, knownEvidenceRefs, provider);
      logRcaEvent({ correlationId, stage: "technical", outcome: "succeeded", response: technicalResponse });
      enrichedBase = {
        ...enrichedBase,
        messages: [...enrichedBase.messages, {
          role: "user",
          content: `РЕЗУЛЬТАТ TECHNICAL EXPERT (инженерная интерпретация; механизмы отказа являются гипотезами, а не подтверждёнными причинами):\n${technicalResponse.content}`,
        }],
      };
    } catch (error) {
      logRcaEvent({ correlationId, stage: "technical", outcome: "failed", error });
      const cause = error instanceof RcaPipelineError ? error.cause : error;
      const canContinue = cause instanceof AiGatewayError && [
        "FREE_QUOTA_EXCEEDED",
        "MODEL_UNAVAILABLE",
        "PROVIDER_UNAVAILABLE",
        "INVALID_AI_RESPONSE",
      ].includes(cause.code);
      if (!canContinue) throw new RcaPipelineError("technical", correlationId, error);
      enrichedBase = {
        ...enrichedBase,
        messages: [...enrichedBase.messages, {
          role: "user",
          content: `РЕЗУЛЬТАТ TECHNICAL EXPERT (degraded mode):\n${technicalExpertUnavailableFinding(knownEvidenceRefs)}\nНе останавливай RCA: Analyst, Critic и Composer должны продолжить анализ исходных доказательств. Не выдумывай технические факты или причины.`,
        }],
      };
    }
  }

  const analystRequest = agentRequest(
    enrichedBase,
    "analyst",
    "Ты Analyst в RCA. Извлеки только FACT, SYMPTOM, HYPOTHESIS и MISSING_DATA. Учитывай результаты Photo Agent, Video Agent, Document Agent и Technical Expert. Технические механизмы из Technical Expert рассматривай только как гипотезы, пока их не подтверждают измерения или документы. Для документированных фактов используй source=DOCUMENTED и точный evidenceRef документа. Не выдумывай факты. Каждая гипотеза должна ссылаться на индексы фактов.",
    "Проанализируй входной кейс и материалы. Верни только JSON по агентской схеме.",
    agentFormat("pump_rca_analyst"),
  );
  const { finding: analystFinding } = await runFindingAgent(provider, analystRequest, "analyst", correlationId);

  const textBase = textOnlyRequest(enrichedBase);
  const criticRequest = agentRequest(
    textBase,
    "critic",
    "Ты независимый Critic RCA. Проверь вывод Analyst на противоречия, неподтверждённые факты, неверные evidenceRefs и пропущенные данные. Не создавай новые факты.",
    `Проверь этот вывод Analyst:\n${JSON.stringify(analystFinding)}\nИсходный кейс уже находится в предыдущем контексте запроса. Верни только JSON по агентской схеме; используй hypotheses для спорных пунктов и missingData для проблем.`,
    agentFormat("pump_rca_critic"),
  );
  const { finding: criticFinding } = await runFindingAgent(provider, criticRequest, "critic", correlationId);

  const composePrompt = `Собери итоговый RCA-отчёт по исходному кейсу. Analyst:\n${JSON.stringify(analystFinding)}\nCritic:\n${JSON.stringify(criticFinding)}\n\nСохрани только проверяемые факты. Гипотезы не называй подтверждённой причиной. Используй только evidenceRefs из: ${JSON.stringify(knownEvidenceRefs)} или narrative/case narrative. Верни полный JSON по исходной PumpRCA response schema, включая четыре RCA-блока и SMART. При недостатке данных снизь confidence и заполни openQuestions и structuredRca.missingData.`;
  let lastError: unknown;
  const attemptedComposerModels: string[] = [];
  const composerModels = allowlistedModelIds("composer");
  for (let attempt = 0; attempt < Math.min(2, composerModels.length); attempt += 1) {
    const requestedModel = attempt === 0 ? composerModels[0] : undefined;
    try {
      const composed = await runAgent(provider, {
        ...textBase,
        task: "RCA",
        agentRole: "composer",
        model: requestedModel,
        excludeModels: [...(base.excludeModels ?? []), ...attemptedComposerModels],
        messages: [...textBase.messages, { role: "user", content: composePrompt }],
        responseFormat: composerFormat(),
        reasoning: { enabled: false },
        maxTokens: base.maxTokens ?? 5000,
      }, "composer", correlationId);
      attemptedComposerModels.push(composed.model);
      const validated = normalizeAndValidateRca(composed.content, { knownEvidenceRefs });
      logRcaEvent({ correlationId, stage: "validation", outcome: "succeeded", response: composed });
      return { ...composed, content: JSON.stringify(validated) };
    } catch (error) {
      lastError = error instanceof RcaPipelineError ? error.cause : error;
      if (requestedModel && !attemptedComposerModels.includes(requestedModel)) attemptedComposerModels.push(requestedModel);
      const failedModel = lastError instanceof AiGatewayError ? lastError.modelId : undefined;
      if (failedModel && !attemptedComposerModels.includes(failedModel)) attemptedComposerModels.push(failedModel);
      logRcaEvent({ correlationId, stage: "validation", outcome: "failed", error: lastError });
    }
  }
  throw new RcaPipelineError("validation", correlationId, lastError ?? new AiGatewayError("INVALID_AI_RESPONSE", "RCA composer did not produce a valid structured result."));
}
