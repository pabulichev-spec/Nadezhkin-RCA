import { describe, expect, it } from "vitest";
import { runTechnicalExpertAnalysis } from "../server/ai/technical-expert-agent";
import { allowlistedModelIds } from "../server/ai/free-allowlist";
import { AiGatewayError, type AiRequest, type AiResponse } from "../server/ai/types";

const validResult = {
  equipmentAssessment: "Насос: данных недостаточно для оценки конструкции и режима работы.",
  technicalFacts: [{
    statement: "В журнале указана повышенная вибрация.",
    source: "DOCUMENTED",
    evidenceRefs: ["shift-log"],
  }],
  failureMechanisms: [{
    mechanism: "Возможная механическая несоосность.",
    explanation: "Может вызывать рост вибрации; требуется подтверждение измерениями.",
    supportingFactIndexes: [0],
    alternativeExplanations: ["Дисбаланс", "Ослабление крепления"],
    confidence: 25,
    status: "HYPOTHESIS",
  }],
  diagnosticChecks: [{
    check: "Проверить центровку после безопасной остановки.",
    purpose: "Проверить гипотезу несоосности.",
    method: "По утверждённой процедуре с изоляцией энергии.",
    priority: "HIGH",
  }],
  requiredMeasurements: [{
    parameter: "Виброскорость",
    why: "Нужна оценка фактического состояния.",
    conditions: "По утверждённой программе измерений.",
  }],
  missingTechnicalData: ["Нет паспорта насоса и протокола центровки."],
  safetyPrecautions: ["Не выполнять работы без остановки и изоляции энергии."],
  confidence: 35,
};

function response(content: string): AiResponse {
  return { content, model: allowlistedModelIds("reserve")[0], provider: "openrouter", usage: { cost: 0 } };
}

const messages: AiRequest["messages"] = [{
  role: "user",
  content: [
    { type: "text", text: "Насос P-204: рост вибрации. Данные из журнала смены." },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,not-forwarded-to-text-expert" } },
  ],
}];

describe("Technical Expert", () => {
  it("uses the free reserve route and sends text context only", async () => {
    let captured: AiRequest | undefined;
    const result = await runTechnicalExpertAnalysis(messages, ["shift-log", "narrative"], async (request) => {
      captured = request;
      return response(JSON.stringify(validResult));
    });

    expect(captured?.task).toBe("EQUIPMENT_ANALYSIS");
    expect(captured?.agentRole).toBe("reserve");
    expect(captured?.model).toBe(allowlistedModelIds("reserve")[0]);
    expect(captured?.responseFormat).toBeDefined();
    expect(captured?.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))).toBe(false);
    expect(result.content).toContain('"mechanism":"Возможная механическая несоосность."');
    expect(result.usage.cost).toBe(0);
  });

  it("retries through the zero-cost pool when a route rejects structured output", async () => {
    const requests: AiRequest[] = [];
    const result = await runTechnicalExpertAnalysis(messages, ["shift-log"], async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        throw new AiGatewayError("MODEL_UNAVAILABLE", "structured output is not supported", 400, request.model);
      }
      return response(`Ответ модели:\n\n\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``);
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].responseFormat).toBeDefined();
    expect(requests[1].responseFormat).toBeUndefined();
    expect(requests[1].model).toBeUndefined();
    expect(requests[1].excludeModels).toEqual([allowlistedModelIds("reserve")[0]]);
    expect(JSON.parse(result.content).equipmentAssessment).toContain("данных недостаточно");
    expect(result.usage.cost).toBe(0);
  });

  it("rejects facts that cite an unknown evidence reference", async () => {
    const invalid = structuredClone(validResult);
    invalid.technicalFacts[0].evidenceRefs = ["invented-document.pdf"];
    await expect(runTechnicalExpertAnalysis(messages, ["shift-log"], async () => response(JSON.stringify(invalid))))
      .rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });

  it("rejects failure mechanisms that reference a nonexistent fact index", async () => {
    const invalid = structuredClone(validResult);
    invalid.failureMechanisms[0].supportingFactIndexes = [4];
    await expect(runTechnicalExpertAnalysis(messages, ["shift-log"], async () => response(JSON.stringify(invalid))))
      .rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });

  it("rejects failure mechanisms without a supporting technical fact", async () => {
    const invalid = structuredClone(validResult);
    invalid.failureMechanisms[0].supportingFactIndexes = [];
    await expect(runTechnicalExpertAnalysis(messages, ["shift-log"], async () => response(JSON.stringify(invalid))))
      .rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });

  it("requires an evidence reference allowlist", async () => {
    await expect(runTechnicalExpertAnalysis(messages, [], async () => response(JSON.stringify(validResult))))
      .rejects.toBeInstanceOf(AiGatewayError);
  });
});
