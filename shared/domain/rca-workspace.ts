import type { CauseNode, DomainState, FiveWhy, Investigation, RcaTask, RootCause, CorrectiveAction } from "./types";

const id = (prefix: string, n: number) => `${prefix}-${Date.now()}-${n}`;
const stamp = () => new Date().toISOString();
export const RCA_TASK_TITLES = ["Зафиксировать факт отказа", "Проверить хронологию", "Собрать рабочие параметры", "Проверить симптомы", "Собрать фото и видео", "Проверить журналы и АСУ ТП", "Проверить измерения", "Проверить защиту и сигнализацию", "Проверить режим эксплуатации", "Проверить монтаж и центровку", "Проверить смазку и подшипники", "Проверить уплотнения и проточную часть", "Проверить ремонтную историю", "Сформировать и сравнить гипотезы", "Построить Cause Tree и 5 Why", "Подготовить root cause и мероприятия"] as const;
export function createRcaTasks(investigationId: string): RcaTask[] { const at = stamp(); return RCA_TASK_TITLES.map((title, i) => ({ id: id("task", i), investigationId, number: i + 1, title, status: "TODO", evidenceIds: [], createdAt: at, updatedAt: at })); }
export function createCauseNode(investigationId: string, input: Omit<CauseNode, "id" | "investigationId">): CauseNode { return { ...input, id: id("cause", Date.now()), investigationId }; }
export function addWhy(investigation: Investigation, input: Omit<FiveWhy, "id">): Investigation { return { ...investigation, fiveWhys: [...(investigation.fiveWhys ?? []), { ...input, id: id("why", input.level) }], updatedAt: stamp() }; }
export function confirmRootCause(investigation: Investigation, rootCause: RootCause): Investigation { if (!rootCause.statement.trim() || !rootCause.confirmedBy?.trim()) throw new Error("Root Cause требует формулировку и подтверждение инженера"); return { ...investigation, rootCause: { ...rootCause, confirmedAt: stamp() }, updatedAt: stamp() }; }
export function makeSmartAction(investigationId: string, input: Omit<CorrectiveAction, "id" | "investigationId" | "status" | "causeNodeIds" | "measurementIds">): CorrectiveAction { return { ...input, id: id("action", Date.now()), investigationId, status: "PLANNED", causeNodeIds: [], measurementIds: [] }; }
export function getCompletion(state: DomainState, investigation: Investigation) {
  const evidence = state.evidence.filter((x) => x.investigationId === investigation.id);
  const measurements = state.measurements.filter((x) => x.investigationId === investigation.id);
  const hypotheses = state.hypotheses.filter((x) => x.investigationId === investigation.id);
  const tasks = state.tasks.filter((x) => x.investigationId === investigation.id);
  const actions = state.actions.filter((x) => x.investigationId === investigation.id);
  const checks = { base: Boolean(investigation.title && investigation.narrative && investigation.pumpId), evidence: evidence.length > 0, measurements: measurements.length > 0, analysis: hypotheses.length > 0 && tasks.length >= 16, cause: Boolean(investigation.rootCause?.statement && investigation.rootCause.confirmedBy), actions: actions.length > 0, report: Boolean(investigation.report) };
  const done = Object.values(checks).filter(Boolean).length;
  return { checks, done, total: Object.keys(checks).length, percent: Math.round(done / Object.keys(checks).length * 100), readyForReview: checks.base && checks.evidence && checks.analysis, readyForApproval: checks.cause && checks.actions, readyForClose: checks.report };
}
