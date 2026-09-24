import { describe, expect, it } from "vitest";

import { formatRcaEvidence, getConfidenceBand, hasActionableRca, matchesCaseFilters } from "../shared/rca";
import { buildRcaChatPrompt } from "../shared/chat";
import { buildRcaReportHtml } from "../shared/report";

describe("RCA utilities", () => {
  it("maps confidence to an interpretable band", () => {
    expect(getConfidenceBand(82)).toBe("high");
    expect(getConfidenceBand(61)).toBe("medium");
    expect(getConfidenceBand(24)).toBe("low");
  });

  it("formats evidence without inventing a note", () => {
    expect(formatRcaEvidence("photo", "bearing.jpg")).toBe("PHOTO — bearing.jpg.");
    expect(formatRcaEvidence("text", "shift log", "  vibration 8.4 mm/s  ")).toBe("TEXT — shift log. Примечание: vibration 8.4 mm/s");
    expect(formatRcaEvidence("photo", "bearing.jpg", undefined, [{ id: "m1", x: 0.4, y: 0.5, text: "скол на кольце" }])).toContain("скол на кольце");
  });

  it("accepts only actionable RCA output", () => {
    expect(hasActionableRca({ rootCause: "Process gap", recommendations: [{ action: "Add check" }], openQuestions: [] })).toBe(true);
    expect(hasActionableRca({ rootCause: "", recommendations: [{ action: "Add check" }], openQuestions: [] })).toBe(false);
    expect(hasActionableRca({ rootCause: "Process gap", recommendations: [], openQuestions: [] })).toBe(false);
  });

  it("builds an exportable report with root cause and marker notes", () => {
    const html = buildRcaReportHtml({
      title: "Разрушение подшипника P-204",
      equipmentType: "Центробежный насос",
      assetTag: "P-204",
      location: "Цех 2",
      severity: "Высокий",
      narrative: "Рост вибрации перед остановом",
      tags: ["вибрация"],
      evidence: [{ kind: "photo", name: "bearing.jpg", annotations: [{ id: "m1", x: 0.3, y: 0.2, text: "след перегрева" }] }],
      result: {
        executiveSummary: "Рабочая гипотеза",
        eventChain: ["Рост вибрации", "Останов"],
        immediateCause: "Перегрев",
        contributingFactors: ["Нет контроля"],
        rootCause: "Пробел в процессе запуска",
        recommendations: [{ priority: "P1", action: "Проверить центровку", owner: "Механики", horizon: "24 часа" }],
        confidence: 78,
        openQuestions: ["Есть протокол?"],
        methodNotes: "Требуется проверка",
      },
    }, "24 сен 2026");
    expect(html).toContain("Пробел в процессе запуска");
    expect(html).toContain("след перегрева");
    expect(html).toContain("PUMPRCA / RCA REPORT");
  });

  it("filters cases by query, tag and status", () => {
    const item = { title: "Вибрация P-204", assetTag: "P-204", location: "Цех 2", equipmentType: "Центробежный насос", narrative: "Рост вибрации", tags: ["вибрация", "подшипник"], status: "Готово" };
    expect(matchesCaseFilters(item, "p-204", "вибрация", "Готово")).toBe(true);
    expect(matchesCaseFilters(item, "p-204", "подача", "Готово")).toBe(false);
    expect(matchesCaseFilters(item, "p-204", "Все", "В работе")).toBe(false);
  });

  it("keeps the chat grounded in the selected RCA context", () => {
    const prompt = buildRcaChatPrompt({
      caseTitle: "Вибрация P-204",
      equipmentType: "Центробежный насос",
      assetTag: "P-204",
      location: "Цех 2",
      narrative: "Рост вибрации",
      result: {
        executiveSummary: "Гипотеза",
        eventChain: ["Запуск", "Рост вибрации"],
        immediateCause: "Перегрев",
        contributingFactors: ["Нет контроля"],
        rootCause: "Пробел в чек-листе",
        recommendations: [],
        confidence: 70,
        openQuestions: ["Есть протокол?"],
        methodNotes: "Нужна проверка",
      },
      evidence: [{ kind: "photo", name: "bearing.jpg", note: "След перегрева" }],
      history: [{ role: "user", content: "Почему это корневая причина?" }],
    });
    expect(prompt).toContain("Пробел в чек-листе");
    expect(prompt).toContain("След перегрева");
    expect(prompt).toContain("Почему это корневая причина?");
    expect(prompt).toContain("не выдумывай измерения");
  });
});
