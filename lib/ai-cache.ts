import AsyncStorage from "@react-native-async-storage/async-storage";

import { EMPTY_AI_USAGE, mergeAiUsage, type AiUsageStats } from "@/shared/ai";

const USAGE_KEY = "pumprca.ai.usage.v1";
const CACHE_TTL_KEY = "pumprca.ai.cache-ttl-days.v1";
const DEFAULT_TTL_DAYS = 7;
const ALLOWED_TTL_DAYS = [1, 3, 7, 14, 30] as const;

type CacheEnvelope<T> = { createdAt: number; value: T };

export type CacheTtlDays = typeof ALLOWED_TTL_DAYS[number];

export async function getCacheTtlDays(): Promise<CacheTtlDays> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_TTL_KEY);
    const days = Number(raw);
    return (ALLOWED_TTL_DAYS.includes(days as CacheTtlDays) ? days : DEFAULT_TTL_DAYS) as CacheTtlDays;
  } catch {
    return DEFAULT_TTL_DAYS;
  }
}

export async function setCacheTtlDays(days: CacheTtlDays) {
  await AsyncStorage.setItem(CACHE_TTL_KEY, String(days));
}

export function getAllowedCacheTtlDays() {
  return ALLOWED_TTL_DAYS;
}

export async function readAiCache<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEnvelope<T>;
    const ttlMs = (await getCacheTtlDays()) * 24 * 60 * 60 * 1000;
    if (!entry.createdAt || Date.now() - entry.createdAt > ttlMs) {
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
