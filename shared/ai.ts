export type AiUsageStats = {
  rcaCalls: number;
  chatCalls: number;
  cacheHits: number;
  cacheMisses: number;
  lastActivityAt?: string;
};

export const EMPTY_AI_USAGE: AiUsageStats = {
  rcaCalls: 0,
  chatCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function makeAiCacheKey(scope: "rca" | "chat", payload: unknown) {
  const input = `${scope}:${stableSerialize(payload)}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pumprca.ai.${scope}.${(hash >>> 0).toString(16)}`;
}

export function mergeAiUsage(current: AiUsageStats, patch: Partial<AiUsageStats>): AiUsageStats {
  return { ...EMPTY_AI_USAGE, ...current, ...patch, lastActivityAt: new Date().toISOString() };
}
