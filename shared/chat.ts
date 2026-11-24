export type RcaChatMessage = { role: "user" | "assistant"; content: string };
import type { StructuredRca } from "./rca";

export type RcaChatContext = {
  caseTitle: string;
  equipmentType: string;
  assetTag: string;
  location: string;
  narrative: string;
  result: {
    executiveSummary: string;
    physicalCause: string;
    humanFactor: string;
    systemicCause: string;
    smartActions: { priority: string; specific: string; measurable: string; achievable: string; relevant: string; timeBound: string }[];
    confidence: number;
    openQuestions: string[];
    methodNotes: string;
    structuredRca: StructuredRca;
  };
  evidence: { kind: string; name: string; note?: string }[];
  history: RcaChatMessage[];
};

export function buildRcaChatPrompt(context: RcaChatContext) {
  const result = context.result;
  const history = context.history.map((message) => `${message.role === "user" ? "U" : "A"}: ${message.content}`).join("\n");
  const evidence = context.evidence.map((item, index) => `${index + 1}.${item.kind}:${item.name}${item.note ? ` — ${item.note}` : ""}`).join("\n");
  const actions = result.smartActions.map((item) => `${item.priority} S:${item.specific}; M:${item.measurable}; A:${item.achievable}; R:${item.relevant}; T:${item.timeBound}`).join(" | ");
  const structured = `FACTS=${result.structuredRca.facts.map((item, index) => `[${index}] ${item.statement} (${item.source}; refs:${item.evidenceRefs.join(",")})`).join(" | ")}; SYMPTOMS=${result.structuredRca.symptoms.map((item) => `${item.statement} (refs:${item.evidenceRefs.join(",")})`).join(" | ")}; HYPOTHESES=${result.structuredRca.hypotheses.map((item) => `${item.statement} [facts:${item.supportingFactIndexes.join(",")}; ${item.status}; ${item.confidence}%]`).join(" | ")}; MISSING_DATA=${result.structuredRca.missingData.join("; ")}`;
  return `Ты — инженер по надёжности. Ответь по-русски на последний вопрос по этому RCA. Используй только контекст; не выдумывай измерения/нормы. Разделяй факт и гипотезу. Если данных мало — скажи, что проверить. Не давай разрешение на эксплуатацию или ремонт.

Кейс:${context.caseTitle}; Оборудование:${context.equipmentType}; Актив:${context.assetTag}; Локация:${context.location}
Событие:${context.narrative}
RCA: structured=${structured}; вывод=${result.executiveSummary}; физика=${result.physicalCause}; персонал=${result.humanFactor}; система=${result.systemicCause}; SMART=${actions}; уверенность=${result.confidence}%; вопросы=${result.openQuestions.join("; ")}; ограничения=${result.methodNotes}
Материалы:${evidence || "нет"}
История:${history || "нет"}
Вопрос:${context.history.at(-1)?.content ?? "нет"}
Ответь кратко и не повторяй весь отчёт без просьбы.`;
}
