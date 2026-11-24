import { describe, expect, it } from "vitest";
import { buildRcaReportHtml } from "../shared/report";

const result = {
  executiveSummary: "Проверка показала отклонение режима работы.",
  physicalCause: "Износ уплотнения.",
  humanFactor: "Нарушение инструкции монтажа.",
  systemicCause: "Недостаточный контроль ремонта.",
  smartActions: [{ priority: "Высокий", specific: "Проверить монтаж", measurable: "100% проверок", achievable: "Службой надёжности", relevant: "Снижает риск повторения", timeBound: "До следующего пуска" }],
  confidence: 40,
  openQuestions: ["Нужна проверка центровки"],
  methodNotes: "Вывод предварительный.",
  structuredRca: {
    facts: [{ statement: "Зафиксирована течь", source: "USER_PROVIDED" as const, evidenceRefs: ["Фото уплотнения"] }],
    symptoms: [{ statement: "Падение подачи", evidenceRefs: ["Фото уплотнения"] }],
    hypotheses: [{ statement: "Нарушен монтаж", supportingFactIndexes: [0], confidence: 40, status: "OPEN" as const }],
    missingData: ["Измерение давления"],
  },
};

describe("RCA PDF report", () => {
  it("uses Russian headings and includes saved workspace data", () => {
    const html = buildRcaReportHtml({
      title: "Пропуск т/у",
      equipmentType: "Центробежный насос",
      assetTag: "МГA-121B",
      location: "Цех 4",
      severity: "Высокий",
      narrative: "После ремонта обнаружена течь.",
      evidence: [{ id: "e1", kind: "photo", name: "Фото уплотнения", note: "Следы течи" }],
      result,
      workspace: {
        failureEvent: { description: "Течь после ремонта", operatingMode: "Пуск", consequences: "Падение подачи" },
        timeline: [{ stage: "Осмотр", occurredAt: "2026-10-30", description: "Обнаружена течь", source: "Журнал" }],
        measurements: [{ parameter: "Давление", value: 2.4, unit: "бар", measuredAt: "2026-10-30" }],
        hypotheses: [{ id: "h1", title: "Нарушен монтаж", status: "NEW", supportingEvidenceIds: ["e1"] }],
        tasks: [{ number: 1, title: "Зафиксировать факт", status: "DONE" }],
        causeNodes: [{ type: "CAUSE", title: "Неправильная установка", evidenceIds: ["e1"] }],
        fiveWhys: [{ level: 1, why: "Почему течь?", answer: "Уплотнение установлено неверно", evidenceIds: ["e1"] }],
        actions: [{ description: "Проверить монтаж", status: "PLANNED", owner: "Иванов" }],
      },
    }, "30 окт. 2026");

    expect(html).toContain("Расследование / событие отказа");
    expect(html).toContain("Четыре обязательных блока RCA");
    expect(html).toContain("Течь после ремонта");
    expect(html).toContain("Давление");
    expect(html).toContain("Неправильная установка");
    expect(html).toContain("Иванов");
    expect(html).not.toContain("Investigation / Failure Event");
    expect(html).not.toContain("AI observations and hypotheses");
  });
});
