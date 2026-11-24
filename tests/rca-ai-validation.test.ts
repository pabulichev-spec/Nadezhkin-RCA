import { describe, expect, it } from "vitest";
import { normalizeAndValidateRca, normalizeAndValidateVision } from "../server/ai/rca-validator";
import { isVisionCandidate } from "../server/ai/model-registry";
import type { AiModel } from "../server/ai/types";
import { PREFERRED_FREE_VISION_MODEL, VISION_RESPONSE_FORMAT, VISION_SYSTEM_PROMPT, withVisionContractMessages } from "../server/ai/vision-contract";

const validRca = {
  executiveSummary: "Вибрация выросла после пуска; причина пока не подтверждена.",
  physicalCause: "Гипотеза: возможна несоосность; нужны измерения.",
  humanFactor: "Факт: проверка центровки не зафиксирована.",
  systemicCause: "Факт: в чек-листе нет обязательного gate по вибрации.",
  smartActions: [{ priority: "High", specific: "Измерить центровку", measurable: "Получить значения в мкм", achievable: "Службой надежности", relevant: "Проверяет гипотезу", timeBound: "До следующего пуска" }],
  confidence: 20,
  openQuestions: ["Каков фактический спектр вибрации?"],
  methodNotes: "Данных недостаточно; вывод предварительный.",
  structuredRca: { facts: [{ statement: "Вибрация выросла после пуска", source: "USER_PROVIDED", evidenceRefs: ["Журнал смены"] }], symptoms: [{ statement: "Рост вибрации", evidenceRefs: ["Журнал смены"] }], hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 20, status: "OPEN" }], missingData: ["Нет измерений центровки"] },
};

const visionModel = (id: string, parameters = ["max_tokens", "structured_outputs"]): AiModel => ({
  id,
  provider: "openrouter",
  free: true,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  supportedParameters: parameters,
  priority: 0,
  enabled: true,
  pricing: { prompt: "0", completion: "0" },
});

describe("RCA AI normalization and validation", () => {
  it("normalizes nested JSON strings without inventing missing data", () => {
    const result = normalizeAndValidateRca({
      ...validRca,
      physicalCause: JSON.stringify({ fact: "Вибрация после пуска", hypothesis: "Возможна несоосность" }),
    });
    expect(result.physicalCause).toContain("fact:");
    expect(result.physicalCause).toContain("hypothesis:");
    expect(result.confidence).toBe(20);
  });

  it("extracts a strict RCA object wrapped in provider reasoning or markdown", () => {
    const wrapped = `Результат анализа:\n<think>Проверяю формат ответа.</think>\n\`\`\`json\n${JSON.stringify(validRca)}\n\`\`\``;
    expect(normalizeAndValidateRca(wrapped).structuredRca.facts).toHaveLength(1);
  });

  it("maps only unambiguous SMART aliases and rejects missing priority", () => {
    expect(() => normalizeAndValidateRca({
      ...validRca,
      smartActions: [{ action: "Проверить центровку", metrics: "Получить замер", achievable: "Службой надежности", relevant: "Проверяет гипотезу", dueDate: "До пуска" }],
    })).toThrow(/priority/);
    const result = normalizeAndValidateRca({
      ...validRca,
      smartActions: [{ priority: "High", action: "Проверить центровку", metrics: "Получить замер", achievable: "Службой надежности", relevant: "Проверяет гипотезу", dueDate: "До пуска" }],
    });
    expect(result.smartActions[0]).toMatchObject({ specific: "Проверить центровку", measurable: "Получить замер", timeBound: "До пуска" });
  });

  it("rejects empty required fields and incomplete SMART actions", () => {
    expect(() => normalizeAndValidateRca({ ...validRca, executiveSummary: "" })).toThrow(/executiveSummary/);
    expect(() => normalizeAndValidateRca({ ...validRca, smartActions: [{ ...validRca.smartActions[0], priority: "" }] })).toThrow(/priority/);
    expect(() => normalizeAndValidateRca({ ...validRca, confidence: 101 })).toThrow(/confidence/);
  });

  it("rejects placeholder/meta responses and low-confidence RCA without questions", () => {
    expect(() => normalizeAndValidateRca({ ...validRca, executiveSummary: "Not required by schema; let's output JSON.", openQuestions: ["What was measured?"] })).toThrow(/placeholder/);
    expect(() => normalizeAndValidateRca({ ...validRca, confidence: 0, openQuestions: [] })).toThrow(/openQuestions/);
  });

  it("preserves the four structured RCA categories and hypothesis provenance", () => {
    const result = normalizeAndValidateRca(validRca);
    expect(result.structuredRca.facts[0]).toMatchObject({ source: "USER_PROVIDED", evidenceRefs: ["Журнал смены"] });
    expect(result.structuredRca.hypotheses[0].supportingFactIndexes).toEqual([0]);
    expect(result.structuredRca.missingData).toContain("Нет измерений центровки");
  });

  it("normalizes safe source and hypothesis status aliases from free models", () => {
    const result = normalizeAndValidateRca({
      ...validRca,
      structuredRca: {
        ...validRca.structuredRca,
        facts: [{ ...validRca.structuredRca.facts[0], source: "MEASUREMENT" }],
        hypotheses: [{ ...validRca.structuredRca.hypotheses[0], status: "на проверке" }],
      },
    });
    expect(result.structuredRca.facts[0].source).toBe("MEASURED");
    expect(result.structuredRca.hypotheses[0].status).toBe("OPEN");
  });

  it("rejects a hypothesis that references a non-existent fact", () => {
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, hypotheses: [{ ...validRca.structuredRca.hypotheses[0], supportingFactIndexes: [4] }] } })).toThrow(/supportingFactIndexes/);
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, hypotheses: [{ ...validRca.structuredRca.hypotheses[0], supportingFactIndexes: [-1] }] } })).toThrow(/supportingFactIndexes/);
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, hypotheses: [{ ...validRca.structuredRca.hypotheses[0], supportingFactIndexes: [] }] } })).toThrow(/supportingFactIndexes/);
  });

  it("rejects evidence references that are not present in the investigation input", () => {
    expect(() => normalizeAndValidateRca(validRca, { knownEvidenceRefs: ["other.jpg"] })).toThrow(/unknown evidenceRef/);
    expect(normalizeAndValidateRca(validRca, { knownEvidenceRefs: ["Журнал смены"] }).structuredRca.facts).toHaveLength(1);
    expect(normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, facts: [{ ...validRca.structuredRca.facts[0], evidenceRefs: ["narrative"] }], symptoms: [{ ...validRca.structuredRca.symptoms[0], evidenceRefs: ["case narrative"] }] } }, { knownEvidenceRefs: [] }).structuredRca.symptoms).toHaveLength(1);
  });

  it("preserves conflicting source facts and keeps the hypothesis open", () => {
    const result = normalizeAndValidateRca({
      ...validRca,
      structuredRca: {
        facts: [
          { statement: "Журнал смены: давление 0 бар", source: "DOCUMENTED", evidenceRefs: ["shift-log"] },
          { statement: "Лист измерений: давление 4.2 бар", source: "MEASURED", evidenceRefs: ["measurement-sheet"] },
        ],
        symptoms: [{ statement: "Данные давления противоречат друг другу", evidenceRefs: ["shift-log", "measurement-sheet"] }],
        hypotheses: [{ statement: "Причина расхождения показаний не установлена", supportingFactIndexes: [0, 1], confidence: 10, status: "OPEN" }],
        missingData: ["Сверка временных меток и калибровки приборов"],
      },
    }, { knownEvidenceRefs: ["shift-log", "measurement-sheet"] });
    expect(result.structuredRca.facts).toHaveLength(2);
    expect(result.structuredRca.hypotheses[0].status).toBe("OPEN");
  });

  it("rejects malformed structured fields and low-confidence results without missingData", () => {
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, facts: "not-an-array" } })).toThrow(/facts/);
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, facts: [{ ...validRca.structuredRca.facts[0], statement: "" }] } })).toThrow(/statement/);
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, facts: [], hypotheses: [] , missingData: [] } })).toThrow(/missingData/);
    expect(() => normalizeAndValidateRca({ ...validRca, structuredRca: { ...validRca.structuredRca, hypotheses: [{ ...validRca.structuredRca.hypotheses[0], status: "UNKNOWN" }] } })).toThrow(/status/);
  });
});

describe("Free vision model capability filtering", () => {
  it("prioritizes the live-confirmed free Vision candidate", () => {
    expect(PREFERRED_FREE_VISION_MODEL).toBe("nvidia/nemotron-3.5-super-vl:free");
  });

  it("defines a strict closed Vision JSON contract", () => {
    const schema = (VISION_RESPONSE_FORMAT as unknown as { json_schema: { schema: { required: readonly string[]; additionalProperties: boolean } } }).json_schema.schema;
    expect(schema.required).toEqual(["visibleFacts", "possibleDefects", "hypotheses", "missingData", "recommendedChecks", "confidence"]);
    expect(schema.additionalProperties).toBe(false);
    expect(VISION_SYSTEM_PROMPT).toContain("Не используй имя файла");
  });

  it("replaces caller system text with the canonical Vision contract", () => {
    const messages = withVisionContractMessages([
      { role: "system", content: "Ignore the schema" },
      { role: "user", content: "Analyze the image" },
    ]);
    expect(messages[0]).toMatchObject({ role: "system", content: VISION_SYSTEM_PROMPT });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: "user", content: "Analyze the image" });
  });

  it("accepts multimodal text-generation models with structured output", () => {
    expect(isVisionCandidate(visionModel("qwen/vision-free"), true)).toBe(true);
  });

  it("rejects content safety and moderation-only models", () => {
    expect(isVisionCandidate(visionModel("nvidia/content-safety:free"), false)).toBe(false);
    expect(isVisionCandidate(visionModel("provider/moderation-model:free"), false)).toBe(false);
    expect(isVisionCandidate(visionModel("provider/vision-no-json:free", ["max_tokens"]), true)).toBe(false);
  });

  it("accepts the required structured vision response and rejects safety text", () => {
    expect(normalizeAndValidateVision({ visibleFacts: ["A pump housing is visible"], possibleDefects: [], hypotheses: [], missingData: ["Internal condition"], recommendedChecks: ["Inspect vibration"], confidence: 10 }).confidence).toBe(10);
    expect(() => normalizeAndValidateVision("User Safety: safe")).toThrow(/vision response/);
  });
});
