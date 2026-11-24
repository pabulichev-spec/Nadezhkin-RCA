import type { AuditEvent, DomainState, Investigation, InvestigationStatus } from "./types";

export type WorkflowTransition = {
  from: InvestigationStatus;
  to: InvestigationStatus;
  label: string;
  requiresReason?: boolean;
};

export type TransitionValidation = {
  allowed: boolean;
  reason?: string;
};

export const STATUS_LABELS: Record<InvestigationStatus, string> = {
  DRAFT: "Черновик",
  DATA_COLLECTION: "Сбор данных",
  ANALYSIS: "Анализ",
  PENDING_REVIEW: "Ожидает проверки",
  APPROVAL: "На утверждении",
  APPROVED: "Утверждено",
  CLOSED: "Закрыто",
};

export const STATUS_PROGRESS: Record<InvestigationStatus, number> = {
  DRAFT: 0,
  DATA_COLLECTION: 20,
  ANALYSIS: 40,
  PENDING_REVIEW: 70,
  APPROVAL: 85,
  APPROVED: 95,
  CLOSED: 100,
};

const TRANSITIONS: WorkflowTransition[] = [
  { from: "DRAFT", to: "DATA_COLLECTION", label: "Начать сбор данных" },
  { from: "DATA_COLLECTION", to: "ANALYSIS", label: "Перейти к анализу" },
  { from: "ANALYSIS", to: "PENDING_REVIEW", label: "Передать на проверку" },
  { from: "PENDING_REVIEW", to: "APPROVAL", label: "Передать на утверждение" },
  { from: "PENDING_REVIEW", to: "ANALYSIS", label: "Вернуть на анализ", requiresReason: true },
  { from: "APPROVAL", to: "APPROVED", label: "Утвердить" },
  { from: "APPROVAL", to: "ANALYSIS", label: "Вернуть на анализ", requiresReason: true },
  { from: "APPROVED", to: "CLOSED", label: "Закрыть расследование" },
  { from: "APPROVED", to: "ANALYSIS", label: "Вернуть на анализ", requiresReason: true },
];

export function getAllowedTransitions(status: InvestigationStatus): WorkflowTransition[] {
  return TRANSITIONS.filter((transition) => transition.from === status);
}

export function canTransition(currentStatus: InvestigationStatus, targetStatus: InvestigationStatus): boolean {
  return TRANSITIONS.some((transition) => transition.from === currentStatus && transition.to === targetStatus);
}

function hasPump(investigation: Investigation, state: DomainState): boolean {
  return Boolean(investigation.pumpId && state.pumps.some((pump) => pump.id === investigation.pumpId));
}

export function validateTransition(
  investigation: Investigation,
  targetStatus: InvestigationStatus,
  state: DomainState,
  reason?: string,
): TransitionValidation {
  const transition = TRANSITIONS.find((item) => item.from === investigation.status && item.to === targetStatus);
  if (!transition) {
    return { allowed: false, reason: `Переход «${STATUS_LABELS[investigation.status]} → ${STATUS_LABELS[targetStatus]}» запрещён.` };
  }

  if (transition.requiresReason && !reason?.trim()) {
    return { allowed: false, reason: "Для возврата необходимо указать причину." };
  }

  if (investigation.status === "DRAFT" && !hasPump(investigation, state)) {
    return { allowed: false, reason: "Нельзя начать сбор данных: не выбрано оборудование." };
  }

  if (investigation.status === "DATA_COLLECTION" && targetStatus === "ANALYSIS") {
    if (!hasPump(investigation, state)) return { allowed: false, reason: "Нельзя перейти к анализу: не выбрано оборудование." };
    if (!investigation.narrative.trim()) return { allowed: false, reason: "Нельзя перейти к анализу: не указано описание события отказа." };
    if (!investigation.createdAt) return { allowed: false, reason: "Нельзя перейти к анализу: отсутствует дата расследования." };
  }

  if (investigation.status === "APPROVAL" && targetStatus === "APPROVED" && !investigation.narrative.trim()) {
    return { allowed: false, reason: "Нельзя утвердить расследование: отсутствует итоговое заключение." };
  }

  return { allowed: true };
}

export function getStatusLabel(status: InvestigationStatus): string {
  return STATUS_LABELS[status];
}

export function getStatusProgress(status: InvestigationStatus): number {
  return STATUS_PROGRESS[status];
}

export function getTransitionEventType(from: InvestigationStatus, to: InvestigationStatus): "STATUS_CHANGED" | "STATUS_RETURNED" | "INVESTIGATION_APPROVED" | "INVESTIGATION_CLOSED" {
  if (to === "CLOSED") return "INVESTIGATION_CLOSED";
  if (to === "APPROVED") return "INVESTIGATION_APPROVED";
  if (to === "ANALYSIS" && from !== "DRAFT" && from !== "DATA_COLLECTION") return "STATUS_RETURNED";
  return "STATUS_CHANGED";
}

export type WorkflowRepository = {
  getState(): Promise<DomainState>;
  commitInvestigationTransition(input: {
    investigationId: string;
    expectedStatus: InvestigationStatus;
    nextStatus: InvestigationStatus;
    auditEvent: AuditEvent;
  }): Promise<Investigation>;
};

export async function transitionInvestigation(
  repository: WorkflowRepository,
  investigationId: string,
  targetStatus: InvestigationStatus,
  options: { reason?: string; actorId?: string } = {},
): Promise<Investigation> {
  const state = await repository.getState();
  const investigation = state.investigations.find((item) => item.id === investigationId);
  if (!investigation) throw new Error(`Investigation not found: ${investigationId}`);

  const validation = validateTransition(investigation, targetStatus, state, options.reason);
  if (!validation.allowed) throw new Error(validation.reason ?? "Переход статуса запрещён.");

  const timestamp = new Date().toISOString();
  const eventType = getTransitionEventType(investigation.status, targetStatus);
  const auditEvent: AuditEvent = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    investigationId,
    entityType: "Investigation",
    entityId: investigationId,
    action: eventType,
    oldValue: investigation.status,
    newValue: targetStatus,
    comment: options.reason?.trim() || undefined,
    timestamp,
    actorId: options.actorId,
  };

  return repository.commitInvestigationTransition({
    investigationId,
    expectedStatus: investigation.status,
    nextStatus: targetStatus,
    auditEvent,
  });
}
