import { describe, expect, it } from "vitest";

import { formatRcaEvidence, getConfidenceBand, hasActionableRca, isValidCacheableRcaResult, matchesCaseFilters, removeCaseById } from "../shared/rca";
import { buildRcaChatPrompt } from "../shared/chat";
import { buildRcaReportHtml } from "../shared/report";
import { makeAiCacheKey, stableSerialize } from "../shared/ai";
import { EQUIPMENT_TYPES, filterEquipmentTypes, isKnownEquipmentType } from "../shared/equipment";

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
    expect(hasActionableRca({ systemicCause: "Process gap", smartActions: [{ specific: "Add check" }], openQuestions: [] })).toBe(true);
    expect(hasActionableRca({ systemicCause: "", smartActions: [{ specific: "Add check" }], openQuestions: [] })).toBe(false);
    expect(hasActionableRca({ systemicCause: "Process gap", smartActions: [], openQuestions: [] })).toBe(false);
  });

  it("rejects an incomplete RCA response before it can reach the result view", () => {
    expect(isValidCacheableRcaResult({
      executiveSummary: "Есть предварительная гипотеза",
      physicalCause: "Причина требует проверки",
      humanFactor: "Данные отсутствуют",
      systemicCause: "Процесс требует проверки",
      smartActions: [],
      confidence: 40,
      openQuestions: ["Нужен замер"],
      methodNotes: "Не завершено",
    })).toBe(false);
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
        physicalCause: "Перегрев",
        humanFactor: "Нет контроля",
        systemicCause: "Пробел в процессе запуска",
        smartActions: [{ priority: "P1", specific: "Проверить центровку", measurable: "Вибрация до 4 мм/с", achievable: "Механики", relevant: "Исключить повторный отказ", timeBound: "24 часа" }],
        confidence: 78,
        openQuestions: ["Есть протокол?"],
        methodNotes: "Требуется проверка",
        structuredRca: { facts: [{ statement: "Рост вибрации зафиксирован оператором", source: "USER_PROVIDED", evidenceRefs: ["bearing.jpg"] }], symptoms: [{ statement: "Перегрев подшипника", evidenceRefs: ["bearing.jpg"] }], hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 40, status: "OPEN" }], missingData: ["Нет протокола центровки"] },
      },
    }, "24 сен 2026");
    expect(html).toContain("Пробел в процессе запуска");
    expect(html).toContain("Физическая причина");
    expect(html).toContain("Физическая причина:</b> Перегрев");
    expect(html).toContain("Человеческий фактор");
    expect(html).toContain("Системная причина");
    expect(html).toContain("SMART");
    expect(html).toContain("Рост вибрации зафиксирован оператором");
    expect(html).toContain("НЕДОСТАЮЩИЕ ДАННЫЕ");
    expect(html).toContain("Нет протокола центровки");
    expect(html).toContain("след перегрева");
    expect(html).toContain("НАДЁЖКИН / ОТЧЁТ RCA");
  });

  it("projects all available workspace data without inventing confirmation or measurements", () => {
    const html = buildRcaReportHtml({
      title: "MGA-121B", equipmentType: "Центробежный насос", assetTag: "MGA-121B", location: "2111", severity: "Высокий", narrative: "Пропуск т/у",
      evidence: [{ id: "ev-1", kind: "photo", name: "seal.jpg", mediaHash: "hash-1", note: "Осмотр" }],
      result: {
        executiveSummary: "Предварительный вывод", physicalCause: "Гипотеза физической причины", humanFactor: "Данные отсутствуют", systemicCause: "Проверка процесса требуется",
        smartActions: [{ priority: "P1", specific: "Проверить уплотнение", measurable: "Получить протокол", achievable: "После осмотра", relevant: "Проверяет гипотезу", timeBound: "До следующего пуска" }],
        confidence: 35, openQuestions: ["Какова модель уплотнения?"], methodNotes: "Причина не подтверждена",
        structuredRca: { facts: [{ statement: "Есть утечка", source: "MEDIA_OBSERVED", evidenceRefs: ["ev-1"] }], symptoms: [{ statement: "Пропуск т/у", evidenceRefs: ["ev-1"] }], hypotheses: [{ statement: "Возможен износ", supportingFactIndexes: [0], confidence: 35, status: "OPEN" }], missingData: ["Модель уплотнения"] },
      },
      workspace: {
        timeline: [{ id: "tl-1", stage: "Обнаружение", occurredAt: "2026-10-21T10:00:00Z", description: "Обнаружена утечка", source: "Журнал смены" }],
        measurements: [{ id: "m-1", parameter: "Давление", value: null, unit: "бар", measuredAt: "2026-10-21T10:10:00Z", source: "Не измерено", comment: "Ожидается замер", evidenceIds: ["missing-measurement"] }],
        tasks: [{ number: 1, title: "Зафиксировать факт отказа", status: "TODO", comment: "Нужна запись", owner: "", evidenceIds: ["ev-1"] }],
        actions: [{ description: "Осмотреть уплотнение", status: "PLANNED", owner: "", dueAt: "", actualResult: "" }],
        rootCause: { statement: "Возможен износ", type: "Technical", confirmedBy: "Ответственный инженер", confirmedAt: "2026-10-21T10:00:00Z" },
      },
    }, "21.10.2026");
    expect(html).toContain("Обнаружена утечка");
    expect(html).toContain("2026-10-21T10:10:00Z");
    expect(html).toContain("Источник недоступен: missing-measurement");
    expect(html).not.toContain("Нужна запись");
    expect(html).toContain("Осмотреть уплотнение");
    expect(html).toContain("Гипотеза / требует подтверждения");
    expect(html).toContain("SMART-рекомендации являются рекомендациями ИИ и не означают выполнения мероприятия");
    expect(html).toContain("Контрольный список RCA / 16 шагов");
    expect(html).toContain("Шаги контроля отображают фактически сохранённый статус проверки");
    expect(html).not.toContain("<th>Комментарий</th><th>Ответственный</th><th>Срок</th><th>Evidence</th>");
    expect(html).not.toContain("Измерения не заполнены");
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
        physicalCause: "Перегрев",
        humanFactor: "Нет контроля",
        systemicCause: "Пробел в чек-листе",
        smartActions: [],
        confidence: 70,
        openQuestions: ["Есть протокол?"],
        methodNotes: "Нужна проверка",
        structuredRca: { facts: [{ statement: "Рост вибрации зафиксирован оператором", source: "USER_PROVIDED", evidenceRefs: ["bearing.jpg"] }], symptoms: [{ statement: "Перегрев подшипника", evidenceRefs: ["bearing.jpg"] }], hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 40, status: "OPEN" }], missingData: ["Нет протокола центровки"] },
      },
      evidence: [{ kind: "photo", name: "bearing.jpg", note: "След перегрева" }],
      history: [{ role: "user", content: "Почему это корневая причина?" }],
    });
    expect(prompt).toContain("Пробел в чек-листе");
    expect(prompt).toContain("След перегрева");
    expect(prompt).toContain("Почему это корневая причина?");
    expect(prompt).toContain("не выдумывай измерения");
  });

  it("removes only the requested investigation", () => {
    const remaining = removeCaseById([{ id: "a" }, { id: "b" }, { id: "c" }], "b");
    expect(remaining.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("creates the same cache key regardless of object key order", () => {
    expect(stableSerialize({ b: 2, a: 1 })).toBe(stableSerialize({ a: 1, b: 2 }));
    expect(makeAiCacheKey("rca", { b: 2, a: 1 })).toBe(makeAiCacheKey("rca", { a: 1, b: 2 }));
    expect(makeAiCacheKey("rca", { a: 1 })).not.toBe(makeAiCacheKey("chat", { a: 1 }));
  });

  it("searches the expanded equipment list and supports custom types", () => {
    expect(EQUIPMENT_TYPES.length).toBeGreaterThanOrEqual(16);
    expect(filterEquipmentTypes("пор")).toContain("Поршневой насос");
    expect(filterEquipmentTypes("мембран")).toContain("Диафрагменный (мембранный) насос");
    expect(isKnownEquipmentType("Погружной насос")).toBe(true);
    expect(isKnownEquipmentType("Насос по проекту X")).toBe(false);
  });
});
