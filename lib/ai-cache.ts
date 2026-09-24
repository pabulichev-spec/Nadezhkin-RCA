import AsyncStorage from "@react-native-async-storage/async-storage";

import { EMPTY_AI_USAGE, mergeAiUsage, type AiUsageStats } from "@/shared/ai";

const USAGE_KEY = "pumprca.ai.usage.v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheEnvelope<T> = { createdAt: number; value: T };

export async function readAiCache<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEnvelope<T>;
    if (!entry.createdAt || Date.now() - entry.createdAt > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(key);
      return undefined;
    }
    return entry.value;
  } catch {
    return undefined;
  }
}

export async function writeAiCache<T>(key: string, value: T) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ createdAt: Date.now(), value } satisfies CacheEnvelope<T>));
  } catch {
    // Caching must never block an analysis.
  }
}

export async function readAiUsage(): Promise<AiUsageStats> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    return raw ? { ...EMPTY_AI_USAGE, ...(JSON.parse(raw) as Partial<AiUsageStats>) } : EMPTY_AI_USAGE;
  } catch {
    return EMPTY_AI_USAGE;
  }
}

export async function recordAiUsage(patch: Partial<AiUsageStats>) {
  const next = mergeAiUsage(await readAiUsage(), patch);
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(next));
  } catch {
    // Usage telemetry is best effort and never blocks the user flow.
  }
  return next;
}

export async function clearAiCache() {
  const keys = await AsyncStorage.getAllKeys();
  const aiKeys = keys.filter((key) => key.startsWith("pumprca.ai.rca.") || key.startsWith("pumprca.ai.chat."));
  if (aiKeys.length > 0) await AsyncStorage.multiRemove(aiKeys);
}
