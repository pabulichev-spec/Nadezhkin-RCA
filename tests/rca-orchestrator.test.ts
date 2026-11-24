import { describe, expect, it, vi } from "vitest";
import { runRcaOrchestrator } from "../server/ai/rca-orchestrator";
import { createRcaErrorEnvelopeCause, getRcaErrorEnvelopeMetadata, RcaPipelineError, logRcaEvent } from "../server/ai/rca-diagnostics";
import { AiGatewayError, type AiRequest, type AiResponse } from "../server/ai/types";
import { allowlistedModelIds } from "../server/ai/free-allowlist";

const finding = JSON.stringify({
  facts: [{ statement: "Рост вибрации зафиксирован", source: "USER_PROVIDED", evidenceRefs: ["shift-log"] }],
  symptoms: [{ statement: "Повышенная вибрация", evidenceRefs: ["shift-log"] }],
  hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 30, status: "OPEN" }],
  missingData: ["Нет протокола центровки"],
});

const final = JSON.stringify({
  executiveSummary: "Предварительный вывод; причина не подтверждена.",
  physicalCause: "Гипотеза: возможна несоосность.",
  humanFactor: "Факт: проверка центровки не зафиксирована.",
  systemicCause: "Гипотеза: контроль после ремонта не зафиксирован.",
  smartActions: [{ priority: "High", specific: "Проверить центровку", measurable: "Получить измерения", achievable: "Службой надежности", relevant: "Проверяет гипотезу", timeBound: "До следующего пуска" }],
  confidence: 30,
  openQuestions: ["Каковы фактические значения вибрации?"],
  methodNotes: "Предварительный результат; нужны измерения.",
  structuredRca: {
    // Generic composer fixture uses the explicitly permitted narrative source.
    // Media/document tests still validate their exact uploaded evidence IDs.
    facts: [{ statement: "Рост вибрации зафиксирован", source: "USER_PROVIDED", evidenceRefs: ["narrative"] }],
    symptoms: [{ statement: "Повышенная вибрация", evidenceRefs: ["narrative"] }],
    hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 30, status: "OPEN" }],
    missingData: ["Нет протокола центровки"],
  },
});

const base: AiRequest = {
  task: "RCA",
  messages: [{ role: "user", content: "Исходное расследование: P-204, вибрация 8.4 мм/с, shift-log." }],
  maxTokens: 5000,
};

function response(content: string): AiResponse {
  return { content, model: "free/test", provider: "openrouter", usage: { cost: 0 }, };
}

describe("multi-agent RCA orchestration", () => {
  it("runs Technical Expert before Analyst and forwards cautious engineering findings through RCA", async () => {
    const requests: AiRequest[] = [];
    const technical = JSON.stringify({
      equipmentAssessment: "По материалам рассматривается центробежный насос; конструктивные параметры не подтверждены.",
      technicalFacts: [{ statement: "В журнале зафиксирована вибрация 8,4 мм/с", source: "DOCUMENTED", evidenceRefs: ["shift-log"] }],
      failureMechanisms: [{ mechanism: "Возможная несоосность", explanation: "Может вызывать повышенную вибрацию; требует проверки измерениями.", supportingFactIndexes: [0], alternativeExplanations: ["Дисбаланс", "Ослабление креплений"], confidence: 35, status: "HYPOTHESIS" }],
      diagnosticChecks: [{ check: "Проверить центровку", purpose: "Оценить гипотезу несоосности", method: "По утверждённой процедуре после безопасной остановки", priority: "HIGH" }],
      requiredMeasurements: [{ parameter: "Виброскорость", why: "Подтвердить распределение вибрации", conditions: "В установленных точках и режимах по локальной процедуре" }],
      missingTechnicalData: ["Нет протокола центровки"],
      safetyPrecautions: ["Перед измерениями обеспечить безопасное состояние оборудования"],
      confidence: 55,
    });
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (request.task === "EQUIPMENT_ANALYSIS") return response(technical);
      if (request.agentRole === "analyst" || request.agentRole === "critic") return response(finding);
      return response(final);
    };

    const result = await runRcaOrchestrator(base, ["shift-log"], { enabled: true, provider });

    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests.map((request) => request.task)).toEqual(["EQUIPMENT_ANALYSIS", "RCA", "RCA", "RCA"]);
    expect(requests[0].agentRole).toBe("reserve");
    expect(requests[1].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ TECHNICAL EXPERT"))).toBe(true);
    expect(requests[2].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ TECHNICAL EXPERT"))).toBe(true);
    expect(requests[3].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ TECHNICAL EXPERT"))).toBe(true);
  });

  it("passes Analyst and Critic outputs to Composer and validates the result", async () => {
    const requests: AiRequest[] = [];
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (requests.length <= 2) return response(finding);
      return response(final);
    };
    const result = await runRcaOrchestrator(base, ["shift-log"], { enabled: true, technicalExpertEnabled: false, provider });
    expect(JSON.parse(result.content).structuredRca.hypotheses[0].supportingFactIndexes).toEqual([0]);
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.agentRole)).toEqual(["analyst", "critic", "composer"]);
    expect(requests.every((request) => request.responseFormat)).toBe(true);
    expect(requests.every((request) => (request.reasoning as { enabled?: boolean } | undefined)?.enabled === false)).toBe(true);
    expect((requests[2].responseFormat as { json_schema?: { name?: string } }).json_schema?.name).toBe("pump_rca_result");
    expect(requests.map((request) => request.model)).toEqual([
      allowlistedModelIds("analyst")[0],
      allowlistedModelIds("critic")[0],
      allowlistedModelIds("composer")[0],
    ]);
    expect(requests[1].messages.at(-1)?.content).toContain("Рост вибрации зафиксирован");
    expect(requests[2].messages.at(-1)?.content).toContain("Нет протокола центровки");
  });


  it("runs Photo Agent before Analyst and binds every visual finding to its exact evidence reference", async () => {
    const requests: AiRequest[] = [];
    const photo = JSON.stringify({
      visibleFacts: ["На наружной поверхности корпуса виден след жидкости"],
      possibleDefects: ["Возможна наружная утечка"],
      hypotheses: ["Возможна негерметичность соединения; требуется проверка"],
      missingData: ["Неизвестно рабочее давление"],
      recommendedChecks: ["Осмотреть соединение после безопасной остановки"],
      confidence: 78,
    });
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (request.task === "PHOTO_ANALYSIS") return response(photo);
      if (request.agentRole === "analyst" || request.agentRole === "critic") return response(finding);
      return response(final);
    };
    const result = await runRcaOrchestrator({
      ...base,
      photoImages: [{ evidenceRef: "seal-leak.jpg", imageData: "data:image/jpeg;base64,ZmFrZQ==" }],
    }, ["seal-leak.jpg"], { enabled: true, technicalExpertEnabled: false, provider });

    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests.map((request) => request.task)).toEqual(["PHOTO_ANALYSIS", "RCA", "RCA", "RCA"]);
    expect(requests[0].agentRole).toBe("vision");
    expect(requests[0].messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))).toBe(true);
    expect(requests[1].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ ОТДЕЛЬНОГО PHOTO AGENT") && message.content.includes("seal-leak.jpg"))).toBe(true);
    expect(requests[1].photoImages).toBeUndefined();
  });

  it("runs Video Agent before Analyst and forwards timestamped findings into RCA context", async () => {
    const requests: AiRequest[] = [];
    const video = JSON.stringify({
      sequenceEvents: [{ timestampMs: 2500, observation: "Видна капля на стыке корпуса", significance: "Возможная утечка; причина не установлена" }],
      visibleFacts: ["Капля жидкости на стыке корпуса"],
      possibleDefects: ["Возможная наружная утечка"],
      hypotheses: ["Возможна негерметичность соединения"],
      missingData: ["Нет данных о давлении"],
      recommendedChecks: ["Проверить соединение после безопасной остановки"],
      confidence: 70,
    });
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (request.task === "VIDEO_ANALYSIS") return response(video);
      if (request.agentRole === "analyst" || request.agentRole === "critic") return response(finding);
      return response(final);
    };
    const result = await runRcaOrchestrator({
      ...base,
      videoFrames: [{ evidenceRef: "pump-video.mp4", timestampMs: 2500, imageData: "data:image/jpeg;base64,ZmFrZQ==" }],
    }, ["pump-video.mp4"], { enabled: true, technicalExpertEnabled: false, provider });

    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests.map((request) => request.task)).toEqual(["VIDEO_ANALYSIS", "RCA", "RCA", "RCA"]);
    expect(requests[0].agentRole).toBe("vision");
    expect(requests[1].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ ОТДЕЛЬНОГО VIDEO AGENT"))).toBe(true);
    expect(requests[1].videoFrames).toBeUndefined();
    expect(requests[2].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ ОТДЕЛЬНОГО VIDEO AGENT"))).toBe(true);
  });

  it("preserves Photo Agent findings when Video Agent also runs", async () => {
    const requests: AiRequest[] = [];
    const photo = JSON.stringify({ visibleFacts: ["На корпусе виден след жидкости"], possibleDefects: [], hypotheses: [], missingData: ["Нет данных о давлении"], recommendedChecks: ["Осмотреть корпус"], confidence: 80 });
    const video = JSON.stringify({ sequenceEvents: [{ timestampMs: 2500, observation: "Капля жидкости видна на стыке", significance: "Возможная утечка" }], visibleFacts: ["Капля на стыке"], possibleDefects: [], hypotheses: [], missingData: ["Нет данных о давлении"], recommendedChecks: ["Проверить соединение"], confidence: 75 });
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (request.task === "PHOTO_ANALYSIS") return response(photo);
      if (request.task === "VIDEO_ANALYSIS") return response(video);
      if (request.agentRole === "analyst" || request.agentRole === "critic") return response(finding);
      return response(final);
    };
    await runRcaOrchestrator({
      ...base,
      photoImages: [{ evidenceRef: "seal.jpg", imageData: "data:image/jpeg;base64,ZmFrZQ==" }],
      videoFrames: [{ evidenceRef: "seal-video.mp4", timestampMs: 2500, imageData: "data:image/jpeg;base64,ZmFrZQ==" }],
    }, ["seal.jpg", "seal-video.mp4"], { enabled: true, technicalExpertEnabled: false, provider });
    expect(requests.map((request) => request.task)).toEqual(["PHOTO_ANALYSIS", "VIDEO_ANALYSIS", "RCA", "RCA", "RCA"]);
    const analystContext = requests[2].messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");
    expect(analystContext).toContain("РЕЗУЛЬТАТ ОТДЕЛЬНОГО PHOTO AGENT");
    expect(analystContext).toContain("РЕЗУЛЬТАТ ОТДЕЛЬНОГО VIDEO AGENT");
  });

  it("runs Document Agent before Analyst and forwards documented facts with exact evidence refs", async () => {
    const requests: AiRequest[] = [];
    const document = JSON.stringify({
      documentType: "MEASUREMENT_REPORT",
      summary: "Протокол вибрации насоса.",
      facts: [{ statement: "Измерение выполнено 04.11.2026", category: "EVENT", evidenceRef: "vibration.csv" }],
      measurements: [{ parameter: "Виброскорость", value: "8,4", unit: "мм/с", dateOrTime: "04.11.2026 10:30", context: "Точка H", evidenceRef: "vibration.csv" }],
      events: [{ dateOrTime: "04.11.2026 10:30", description: "Зафиксирована виброскорость 8,4 мм/с", evidenceRef: "vibration.csv" }],
      inconsistencies: [],
      missingData: ["Не указана частота вращения"],
      confidence: 96,
    });
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (request.task === "DOCUMENT_ANALYSIS") return response(document);
      if (request.agentRole === "analyst" || request.agentRole === "critic") return response(finding);
      return response(final);
    };
    const result = await runRcaOrchestrator({
      ...base,
      documentFiles: [{ evidenceRef: "vibration.csv", mimeType: "text/csv", fileData: `data:text/csv;base64,${Buffer.from("date,value,unit\n04.11.2026,8.4,mm/s").toString("base64")}` }],
    }, ["vibration.csv"], { enabled: true, technicalExpertEnabled: false, provider });

    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests.map((request) => request.task)).toEqual(["DOCUMENT_ANALYSIS", "RCA", "RCA", "RCA"]);
    expect(requests[0].agentRole).toBe("vision");
    expect(requests[1].messages.some((message) => typeof message.content === "string" && message.content.includes("РЕЗУЛЬТАТ ОТДЕЛЬНОГО DOCUMENT AGENT"))).toBe(true);
    expect(requests[1].documentFiles).toBeUndefined();
    expect(requests[2].messages.some((message) => typeof message.content === "string" && message.content.includes("vibration.csv"))).toBe(true);
  });

  it("keeps image context only for Analyst and avoids the Vision pool for Critic and Composer", async () => {
    const requests: AiRequest[] = [];
    const multimodalBase: AiRequest = {
      ...base,
      messages: [{ role: "user", content: [
        { type: "text", text: "Фото и видео уплотнения приложены." },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,redacted" } },
        { type: "video_url", video_url: { url: "data:video/mp4;base64,redacted" } },
      ] }],
    };
    const provider = async (request: AiRequest) => {
      requests.push(request);
      return requests.length <= 2 ? response(finding) : response(final);
    };
    await runRcaOrchestrator(multimodalBase, ["shift-log"], { enabled: true, technicalExpertEnabled: false, provider });
    expect(requests).toHaveLength(3);
    expect(Array.isArray(requests[0].messages[0].content)).toBe(true);
    expect(requests[0].messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url" }),
      expect.objectContaining({ type: "video_url" }),
    ]));
    expect(requests[1].messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))).toBe(false);
    expect(requests[2].messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))).toBe(false);
  });

  it("fails over after an incompatible Analyst JSON response without weakening validation", async () => {
    const requests: AiRequest[] = [];
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (requests.length === 1) return response("{\"facts\": [}");
      if (requests.length === 2) return response(finding);
      if (requests.length === 3) return response(finding);
      return response(final);
    };

    const result = await runRcaOrchestrator(base, ["shift-log"], { enabled: true, technicalExpertEnabled: false, correlationId: "corr-analyst-invalid-json", provider });

    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests).toHaveLength(4);
    expect(requests[1].model).toBeUndefined();
    expect(requests[1].excludeModels).toContain(requests[0].model);
    expect(requests[1].messages.at(-1)?.content).toContain("только корректный JSON");
  });

  it("accepts provider reasoning wrappers and safe snake_case agent fields", async () => {
    const requests: AiRequest[] = [];
    const wrappedFinding = `Результат:\n\`\`\`json\n${JSON.stringify({
      facts: JSON.parse(finding).facts,
      symptoms: JSON.parse(finding).symptoms,
      hypotheses: JSON.parse(finding).hypotheses,
      missing_data: JSON.parse(finding).missingData,
    })}\n\`\`\``;
    const provider = async (request: AiRequest) => {
      requests.push(request);
      return requests.length <= 2 ? response(wrappedFinding) : response(`\n${final}\n`);
    };
    const result = await runRcaOrchestrator(base, ["shift-log"], { enabled: true, technicalExpertEnabled: false, provider });
    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests).toHaveLength(3);
  });

  it("retries only the failed Composer stage and never reruns Analyst/Critic", async () => {
    const requests: AiRequest[] = [];
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (requests.length <= 2) return response(finding);
      if (requests.length === 3) return response("not-json");
      return response(final);
    };
    const result = await runRcaOrchestrator(base, ["shift-log"], { enabled: true, technicalExpertEnabled: false, provider });
    expect(result.model).toBe("free/test");
    expect(requests).toHaveLength(4);
    expect(requests[3].messages.some((message) => typeof message.content === "string" && message.content.includes("Исходное расследование"))).toBe(true);
  });

  it("passes the failed Composer model in excludeModels before bounded free failover", async () => {
    const requests: AiRequest[] = [];
    const provider = async (request: AiRequest) => {
      requests.push(request);
      if (requests.length <= 2) return response(finding);
      if (requests.length === 3) return { ...response(final), content: "not-json", model: allowlistedModelIds("composer")[0] };
      return { ...response(final), model: allowlistedModelIds("composer")[1] };
    };
    const result = await runRcaOrchestrator(base, ["shift-log"], { enabled: true, technicalExpertEnabled: false, provider });
    expect(JSON.parse(result.content).structuredRca.facts).toHaveLength(1);
    expect(requests).toHaveLength(4);
    expect(requests[3].excludeModels).toContain(allowlistedModelIds("composer")[0]);
    expect(requests[3].model).toBeUndefined();
  });

  it.each(["analyst", "critic"] as const)("wraps %s provider errors with a bounded stage", async (stage) => {
    let calls = 0;
    await expect(runRcaOrchestrator(base, ["shift-log"], {
      enabled: true, technicalExpertEnabled: false,
      correlationId: "corr-agent-error",
      provider: async () => {
        calls += 1;
        if (stage === "analyst" || calls === 2) throw new AiGatewayError("FREE_QUOTA_EXCEEDED", "quota", 429, "free/test");
        return response(finding);
      },
    })).rejects.toMatchObject({ stage, correlationId: "corr-agent-error" });
    expect(calls).toBe(stage === "analyst" ? 1 : 2);
  });

  it("bounds invalid Composer JSON to one retry and returns a validation stage", async () => {
    const requests: AiRequest[] = [];
    await expect(runRcaOrchestrator(base, ["shift-log"], {
      enabled: true, technicalExpertEnabled: false,
      correlationId: "corr-composer-invalid",
      provider: async (request) => {
        requests.push(request);
        if (requests.length <= 2) return response(finding);
        return response("not-json");
      },
    })).rejects.toMatchObject({ stage: "validation", correlationId: "corr-composer-invalid" });
    expect(requests).toHaveLength(4);
  });

  it("does not write error messages, tokens or payloads to structured diagnostics", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logRcaEvent({ correlationId: "corr-safe-log", stage: "composer", outcome: "failed", error: new AiGatewayError("PROVIDER_UNAVAILABLE", "Bearer secret-token user payload", 502, "free/test") });
    const output = errorSpy.mock.calls.flat().join(" ");
    expect(output).toContain("corr-safe-log");
    expect(output).toContain("PROVIDER_UNAVAILABLE");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("user payload");
    errorSpy.mockRestore();
  });

  it("keeps save failures distinguishable from provider failures", () => {
    const error = new RcaPipelineError("save", "corr-save-failure", new Error("database details must not be returned"));
    expect(error.stage).toBe("save");
    expect(error.correlationId).toBe("corr-save-failure");
    expect(error.message).toContain("corr-save-failure");
    expect(error.message).not.toContain("database details");
  });

  it("creates only safe structured metadata for the tRPC envelope", () => {
    const documentCause = createRcaErrorEnvelopeCause("document", "12345678-1234-4234-8234-123456789abc");
    expect(getRcaErrorEnvelopeMetadata(documentCause)).toEqual({ stage: "document", correlationId: "12345678-1234-4234-8234-123456789abc" });
    const technicalCause = createRcaErrorEnvelopeCause("technical", "12345678-1234-4234-8234-123456789abc");
    expect(getRcaErrorEnvelopeMetadata(technicalCause)).toEqual({ stage: "technical", correlationId: "12345678-1234-4234-8234-123456789abc" });
    const cause = createRcaErrorEnvelopeCause("validation", "12345678-1234-4234-8234-123456789abc");
    expect(getRcaErrorEnvelopeMetadata(cause)).toEqual({
      stage: "validation",
      correlationId: "12345678-1234-4234-8234-123456789abc",
    });
    expect(getRcaErrorEnvelopeMetadata({ __pumprcaRcaError: true, stage: "video", correlationId: "12345678-1234-4234-8234-123456789abc" })).toEqual({
      stage: "video",
      correlationId: "12345678-1234-4234-8234-123456789abc",
    });
    expect(getRcaErrorEnvelopeMetadata({ __pumprcaRcaError: true, stage: "validation", correlationId: "secret" })).toBeUndefined();
    expect(getRcaErrorEnvelopeMetadata({ __pumprcaRcaError: true, stage: "validation", correlationId: "12345678-1234-4234-8234-123456789abc", prompt: "private" })).toEqual({
      stage: "validation",
      correlationId: "12345678-1234-4234-8234-123456789abc",
    });
  });
});
