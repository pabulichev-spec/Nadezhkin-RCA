export type ConfidenceBand = "low" | "medium" | "high";

export type PhotoAnnotation = {
  id: string;
  x: number;
  y: number;
  text: string;
};

export type CaseFilterRecord = {
  title: string;
  assetTag: string;
  location: string;
  equipmentType: string;
  narrative: string;
  tags?: string[];
  status: string;
};

export function getConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export function formatRcaEvidence(kind: string, name: string, note?: string, annotations?: PhotoAnnotation[]) {
  const annotationText = annotations?.length ? ` Маркеры: ${annotations.map((item) => item.text).join("; ")}.` : "";
  const base = `${kind.toUpperCase()} — ${name}`;
  return note?.trim() ? `${base}. Примечание: ${note.trim()}${annotationText}` : `${base}.${annotationText}`;
}

export function hasActionableRca(result: { systemicCause?: string; smartActions?: unknown[]; openQuestions?: unknown[] }) {
  return Boolean(result.systemicCause?.trim()) && Boolean(result.smartActions?.length) && Array.isArray(result.openQuestions);
}

export type CacheableRcaResult = {
  executiveSummary: string;
  physicalCause: string;
  humanFactor: string;
  systemicCause: string;
  smartActions: Array<{ priority: string; specific: string; measurable: string; achievable: string; relevant: string; timeBound: string }>;
  confidence: number;
  openQuestions: string[];
  methodNotes: string;
  structuredRca: StructuredRca;
};

export type StructuredFactSource = "USER_PROVIDED" | "MEASURED" | "MEDIA_OBSERVED" | "DOCUMENTED" | "UNKNOWN";
export type StructuredHypothesisStatus = "OPEN" | "SUPPORTED" | "CONFIRMED" | "REJECTED" | "INSUFFICIENT_DATA";
export type StructuredFact = { statement: string; source: StructuredFactSource; evidenceRefs: string[] };
export type StructuredSymptom = { statement: string; evidenceRefs: string[] };
export type StructuredHypothesis = { statement: string; supportingFactIndexes: number[]; confidence: number; status: StructuredHypothesisStatus };
export type StructuredRca = { facts: StructuredFact[]; symptoms: StructuredSymptom[]; hypotheses: StructuredHypothesis[]; missingData: string[] };

const rcaTextFields = ["executiveSummary", "physicalCause", "humanFactor", "systemicCause", "methodNotes"] as const;
const smartFields = ["priority", "specific", "measurable", "achievable", "relevant", "timeBound"] as const;
const factSources = ["USER_PROVIDED", "MEASURED", "MEDIA_OBSERVED", "DOCUMENTED", "UNKNOWN"] as const;
const hypothesisStatuses = ["OPEN", "SUPPORTED", "CONFIRMED", "REJECTED", "INSUFFICIENT_DATA"] as const;

function meaningfulText(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  return text.length >= 3 && text !== "..." && !text.includes("not required by schema") && !text.includes("let's output") && !text.includes("assume schema");
}

function meaningfulSmartField(field: (typeof smartFields)[number], value: unknown) {
  return field === "priority"
    ? typeof value === "string" && value.trim().length > 0
    : meaningfulText(value);
}

function validateStructuredRca(value: unknown): value is StructuredRca {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const structured = value as Record<string, unknown>;
  if (!Array.isArray(structured.facts) || !Array.isArray(structured.symptoms) || !Array.isArray(structured.hypotheses) || !Array.isArray(structured.missingData)) return false;
  const facts = structured.facts as unknown[];
  if (structured.facts.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const fact = item as Record<string, unknown>;
    return !meaningfulText(fact.statement) || !factSources.includes(fact.source as StructuredFactSource) || !Array.isArray(fact.evidenceRefs) || fact.evidenceRefs.some((ref) => !meaningfulText(ref));
  })) return false;
  if (structured.symptoms.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const symptom = item as Record<string, unknown>;
    return !meaningfulText(symptom.statement) || !Array.isArray(symptom.evidenceRefs) || symptom.evidenceRefs.some((ref) => !meaningfulText(ref));
  })) return false;
  if (structured.hypotheses.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const hypothesis = item as Record<string, unknown>;
    return !meaningfulText(hypothesis.statement) || !Array.isArray(hypothesis.supportingFactIndexes) || hypothesis.supportingFactIndexes.length === 0 || hypothesis.supportingFactIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= facts.length) || typeof hypothesis.confidence !== "number" || !Number.isInteger(hypothesis.confidence) || hypothesis.confidence < 0 || hypothesis.confidence > 100 || !hypothesisStatuses.includes(hypothesis.status as StructuredHypothesisStatus);
  })) return false;
  return structured.missingData.every((item) => meaningfulText(item));
}

export function isValidCacheableRcaResult(value: unknown): value is CacheableRcaResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (!rcaTextFields.every((field) => meaningfulText(result[field]))) return false;
  const confidence = result.confidence;
  if (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 0 || confidence > 100) return false;
  if (!Array.isArray(result.openQuestions) || result.openQuestions.some((item) => !meaningfulText(item))) return false;
  if (confidence < 50 && result.openQuestions.length === 0) return false;
  if (!Array.isArray(result.smartActions) || result.smartActions.length === 0) return false;
  if (!validateStructuredRca(result.structuredRca)) return false;
  return result.smartActions.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const action = item as Record<string, unknown>;
    return smartFields.every((field) => meaningfulSmartField(field, action[field]));
  });
}

/** Only maps aliases whose semantics are unambiguous; missing fields stay missing. */
export function normalizeLegacyRcaResult(value: unknown): CacheableRcaResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (isValidCacheableRcaResult(raw)) return raw;
  return undefined;
}

export function removeCaseById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function matchesCaseFilters(item: CaseFilterRecord, query: string, activeTag: string, activeStatus: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const haystack = [item.title, item.assetTag, item.location, item.equipmentType, item.narrative, ...(item.tags ?? [])].join(" ").toLowerCase();
  return (!normalizedQuery || haystack.includes(normalizedQuery)) && (activeTag === "Все" || (item.tags ?? []).includes(activeTag)) && (activeStatus === "Все" || item.status === activeStatus);
}
