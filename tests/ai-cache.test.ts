import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAiCache, removeAiCache, writeAiCache } from "../lib/ai-cache";
import { makeAiCacheKey, RCA_CACHE_PROMPT_VERSION, RCA_CACHE_SCHEMA_VERSION, RCA_CACHE_VALIDATOR_VERSION } from "../shared/ai";
import { isValidCacheableRcaResult, normalizeLegacyRcaResult } from "../shared/rca";

const valid = {
  executiveSummary: "Вибрация после ремонта требует проверки.",
  physicalCause: "Гипотеза: возможна несоосность.",
  humanFactor: "Факт: подтверждение центровки отсутствует.",
  systemicCause: "Гипотеза: контроль после ремонта не зафиксирован.",
  smartActions: [{ priority: "High", specific: "Проверить центровку", measurable: "Получить измерения", achievable: "Службой надежности", relevant: "Проверяет гипотезу", timeBound: "До следующего пуска" }],
  confidence: 20,
  openQuestions: ["Каковы фактические значения вибрации?"],
  methodNotes: "Результат предварительный; нужны измерения.",
  structuredRca: { facts: [{ statement: "Рост вибрации зафиксирован", source: "USER_PROVIDED", evidenceRefs: ["Журнал смены"] }], symptoms: [{ statement: "Повышенная вибрация", evidenceRefs: ["Журнал смены"] }], hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 20, status: "OPEN" }], missingData: ["Нет протокола центровки"] },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(AsyncStorage, "getItem").mockResolvedValue(null);
  vi.spyOn(AsyncStorage, "setItem").mockResolvedValue(undefined);
  vi.spyOn(AsyncStorage, "removeItem").mockResolvedValue(undefined);
});

describe("RCA cache safety", () => {
  it("accepts a valid cached result and rejects incomplete or synthetic legacy values", () => {
    expect(isValidCacheableRcaResult(valid)).toBe(true);
    expect(normalizeLegacyRcaResult(valid)).toEqual(valid);
    expect(isValidCacheableRcaResult({ ...valid, smartActions: [{ priority: "P1", specific: "Уточнить действие", measurable: "Зафиксировать измеримый результат", achievable: "Выполнимо силами службы", relevant: "Связано с причиной", timeBound: "До следующего пуска" }] })).toBe(true);
    expect(normalizeLegacyRcaResult({ immediateCause: "Неизвестно", recommendations: [{ action: "Проверить", owner: "Ответственный" }] })).toBeUndefined();
    expect(isValidCacheableRcaResult({ ...valid, confidence: 0, openQuestions: [] })).toBe(false);
  });

  it("reads a valid envelope and removes malformed JSON or expired entries", async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({ createdAt: Date.now(), value: valid }));
    expect(await readAiCache("pumprca.ai.rca.valid")).toEqual(valid);

    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce("not-json");
    expect(await readAiCache("pumprca.ai.rca.bad")).toBeUndefined();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("pumprca.ai.rca.bad");

    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({ createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, value: valid }));
    expect(await readAiCache("pumprca.ai.rca.expired")).toBeUndefined();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("pumprca.ai.rca.expired");
  });

  it("supports targeted invalidation without affecting other keys", async () => {
    await removeAiCache("pumprca.ai.rca.only-this-entry");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("pumprca.ai.rca.only-this-entry");
  });

  it("changes the key when RCA cache versions change", () => {
    const base = { title: "Case", narrative: "Facts", schemaVersion: RCA_CACHE_SCHEMA_VERSION, promptVersion: RCA_CACHE_PROMPT_VERSION, validatorVersion: RCA_CACHE_VALIDATOR_VERSION };
    const next = { ...base, promptVersion: base.promptVersion + 1 };
    expect(makeAiCacheKey("rca", base)).not.toBe(makeAiCacheKey("rca", next));
  });

  it("writes the cache envelope without changing the result", async () => {
    await writeAiCache("pumprca.ai.rca.valid", valid);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("pumprca.ai.rca.valid", expect.stringContaining('"value"'));
  });
});
