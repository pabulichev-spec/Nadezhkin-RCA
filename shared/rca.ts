export type ConfidenceBand = "low" | "medium" | "high";

export function getConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export function formatRcaEvidence(kind: string, name: string, note?: string) {
  const base = `${kind.toUpperCase()} — ${name}`;
  return note?.trim() ? `${base}. Примечание: ${note.trim()}` : `${base}.`;
}

export function hasActionableRca(result: { rootCause?: string; recommendations?: unknown[]; openQuestions?: unknown[] }) {
  return Boolean(result.rootCause?.trim()) && Boolean(result.recommendations?.length) && Array.isArray(result.openQuestions);
}
