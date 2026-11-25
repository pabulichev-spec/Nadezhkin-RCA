import {
  DOMAIN_SCHEMA_VERSION,
  emptyDomainState,
  type DomainState,
  type Equipment,
  type Evidence,
  type Investigation,
  type Pump,
} from "./types";

export type LegacyCaseLike = {
  id?: unknown;
  title?: unknown;
  equipmentType?: unknown;
  assetTag?: unknown;
  location?: unknown;
  severity?: unknown;
  status?: unknown;
  narrative?: unknown;
  tags?: unknown;
  evidence?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
};

const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const array = <T>(value: unknown): T[] => Array.isArray(value) ? value : [];
const dateOrNow = (value: unknown) => text(value) || new Date().toISOString();
const idFor = (prefix: string, value: unknown, index: number) => `${prefix}-${text(value, String(index))}`;

function legacyStatus(status: unknown): Investigation["status"] {
  if (status === "Готово") return "APPROVED";
  return "DRAFT";
}

function migrateEvidence(caseId: string, raw: unknown, index: number): Evidence {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    id: idFor("evidence", item.id, index),
    investigationId: caseId,
    kind: ["photo", "video", "text", "file", "note"].includes(text(item.kind)) ? text(item.kind) as Evidence["kind"] : "file",
    name: text(item.name, `Evidence ${index + 1}`),
    uri: typeof item.uri === "string" ? item.uri : undefined,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
    note: typeof item.note === "string" ? item.note : undefined,
    mediaHash: typeof item.mediaHash === "string" ? item.mediaHash : undefined,
    createdAt: dateOrNow(item.createdAt),
    linkedHypothesisIds: [],
    linkedCauseNodeIds: [],
    linkedTaskIds: [],
  };
}

export function migrateLegacyCases(legacyCases: unknown): DomainState {
  const state = emptyDomainState();
  const cases = array<LegacyCaseLike>(legacyCases);

  cases.forEach((item, index) => {
    const legacyId = text(item.id, `legacy-${index}`);
    const updatedAt = dateOrNow(item.updatedAt);
    const pump: Pump = {
      id: `pump-${legacyId}`,
      assetTag: text(item.assetTag, `UNASSIGNED-${index + 1}`),
      equipmentType: text(item.equipmentType, "Не указан"),
      location: text(item.location) || undefined,
      metadata: {},
      createdAt: updatedAt,
      updatedAt,
    };
    const evidence = array<unknown>(item.evidence).map((entry, evidenceIndex) => migrateEvidence(legacyId, entry, evidenceIndex));
    const investigation: Investigation = {
      id: legacyId,
      pumpId: pump.id,
      legacyCaseId: legacyId,
      title: text(item.title, `Расследование ${index + 1}`),
      narrative: text(item.narrative),
      severity: text(item.severity) || undefined,
      status: legacyStatus(item.status),
      tags: array<string>(item.tags).filter((tag): tag is string => typeof tag === "string"),
      evidenceIds: evidence.map((entry) => entry.id),
      hypothesisIds: [],
      taskIds: [],
      causeNodeIds: [],
      actionIds: [],
      createdAt: updatedAt,
      updatedAt,
      statusChangedAt: updatedAt,
      legacyData: { ...item },
      symptomIds: [],
      consequenceIds: [],
      timelineEventIds: [],
    };
    state.pumps.push(pump);
    state.investigations.push(investigation);
    state.evidence.push(...evidence);
  });

  return { ...state, schemaVersion: DOMAIN_SCHEMA_VERSION };
}

export function normalizeDomainState(raw: unknown): DomainState {
  const source = raw && typeof raw === "object" ? raw as Partial<DomainState> : {};
  const base = emptyDomainState();
  const investigations = Array.isArray(source.investigations) ? source.investigations.map((item) => {
    const candidate = item as Partial<Investigation> & { status?: unknown };
    const rawStatus = candidate.status as unknown;
    const status = rawStatus === "WAITING_REVIEW" ? "PENDING_REVIEW" : rawStatus;
    return {
      ...candidate,
      status: ["DRAFT", "DATA_COLLECTION", "ANALYSIS", "PENDING_REVIEW", "APPROVAL", "APPROVED", "CLOSED"].includes(status as string)
        ? status as Investigation["status"]
        : "DRAFT",
      statusChangedAt: typeof candidate.statusChangedAt === "string" ? candidate.statusChangedAt : dateOrNow(candidate.updatedAt),
    } as Investigation;
  }) : [];
  const pumps = Array.isArray(source.pumps) ? source.pumps : [];
  const rawEquipment = Array.isArray(source.equipment) ? source.equipment : [];
  const equipment: Equipment[] = rawEquipment.map((item) => item as Equipment);
  for (const pump of pumps) {
    if (equipment.some((item) => item.id === pump.id)) continue;
    equipment.push({
      id: pump.id,
      legacyPumpId: pump.id,
      assetTag: pump.assetTag,
      groupId: "pumps",
      groupLabel: "Насосы",
      kind: "dynamic",
      model: pump.equipmentType,
      location: pump.location,
      manufacturer: pump.manufacturer,
      serialNumber: pump.serialNumber,
      characteristics: pump.metadata,
      capabilities: [],
      components: [],
      measurements: [],
      history: [],
      createdAt: pump.createdAt,
      updatedAt: pump.updatedAt,
    });
  }
  return {
    ...base,
    ...source,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    pumps,
    equipment,
    investigations,
    evidence: Array.isArray(source.evidence) ? source.evidence : [],
    measurements: Array.isArray(source.measurements) ? source.measurements : [],
    hypotheses: Array.isArray(source.hypotheses) ? source.hypotheses : [],
    tasks: Array.isArray(source.tasks) ? source.tasks : [],
    causes: Array.isArray(source.causes) ? source.causes : [],
    actions: Array.isArray(source.actions) ? source.actions : [],
    auditLog: Array.isArray(source.auditLog) ? source.auditLog : [],
    symptoms: Array.isArray(source.symptoms) ? source.symptoms : [],
    consequences: Array.isArray(source.consequences) ? source.consequences : [],
    timeline: Array.isArray(source.timeline) ? source.timeline : [],
  };
}

export function migrateDomainStorage(rawDomain: unknown, legacyCases?: unknown): DomainState {
  if (rawDomain && typeof rawDomain === "object") return normalizeDomainState(rawDomain);
  return migrateLegacyCases(legacyCases);
}
