import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_AI_SETTINGS,
  LOCAL_MODEL,
  buildInvestigatorPrompt,
  isLocalModelReady,
  type RcaInvestigationState,
} from "../shared/local-ai";
import { getBrowserLocalAiDescription, isBrowserLocalAiAvailable } from "../lib/browser-local-ai";

describe("local AI contract", () => {
  it("pins the Apache Qwen GGUF model and conservative mobile defaults", () => {
    expect(LOCAL_MODEL.license).toBe("Apache-2.0");
    expect(LOCAL_MODEL.fileName).toContain("Q4_K_M");
    expect(DEFAULT_LOCAL_AI_SETTINGS.contextTokens).toBe(4096);
    expect(LOCAL_MODEL.vision).toBe(false);
  });

  it("does not report readiness unless the local provider is actually ready", () => {
    expect(isLocalModelReady(DEFAULT_LOCAL_AI_SETTINGS, false)).toBe(false);
    expect(isLocalModelReady(DEFAULT_LOCAL_AI_SETTINGS, true)).toBe(true);
  });

  it("requires evidence statuses and a next useful question", () => {
    const state: RcaInvestigationState = {
      confirmedFacts: [{ id: "f1", source: "journal", text: "Вибрация 8.4 мм/с", status: "ПОДТВЕРЖДЕНО" }],
      hypotheses: [{ id: "h1", source: "analysis", text: "Разцентровка муфты", status: "ГИПОТЕЗА" }],
      rejectedHypotheses: [],
      missingData: ["Протокол лазерной центровки"],
      nextQuestion: "Есть ли протокол центровки после замены?",
    };
    const prompt = buildInvestigatorPrompt({ caseContext: "Центробежный насос P-204", state, userMessage: "Что проверить первым?" });
    expect(prompt).toContain("ПОДТВЕРЖДЕНО");
    expect(prompt).toContain("ГИПОТЕЗА");
    expect(prompt).toContain("Что проверить первым?");
    expect(prompt).toContain("Не завершай расследование");
  });

  it("advertises browser inference as local WebGPU without API credits", () => {
    expect(getBrowserLocalAiDescription()).toContain("WebGPU");
    expect(getBrowserLocalAiDescription()).toContain("без API");
    expect(isBrowserLocalAiAvailable()).toBe(false);
  });
});
