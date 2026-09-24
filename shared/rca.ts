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

export function hasActionableRca(result: { rootCause?: string; recommendations?: unknown[]; openQuestions?: unknown[] }) {
  return Boolean(result.rootCause?.trim()) && Boolean(result.recommendations?.length) && Array.isArray(result.openQuestions);
}

export function matchesCaseFilters(item: CaseFilterRecord, query: string, activeTag: string, activeStatus: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const haystack = [item.title, item.assetTag, item.location, item.equipmentType, item.narrative, ...(item.tags ?? [])].join(" ").toLowerCase();
  return (!normalizedQuery || haystack.includes(normalizedQuery)) && (activeTag === "Все" || (item.tags ?? []).includes(activeTag)) && (activeStatus === "Все" || item.status === activeStatus);
}
