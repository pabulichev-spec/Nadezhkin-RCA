import type { AiModel } from "./types";

export type FreeRouteSnapshot = {
  id: string;
  failures: number;
  cooldownUntil: number;
  lastErrorCode?: string;
  calls: number;
};

const routes = new Map<string, FreeRouteSnapshot>();
const BASE_COOLDOWN_MS = 15_000;
const MAX_COOLDOWN_MS = 5 * 60_000;
const MAX_FAILOVER_ROUTES = 12;

export async function runFreeRouteFailover<T>(
  routeIds: string[],
  run: (routeId: string) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
) {
  const visited = new Set<string>();
  let lastError: unknown;
  for (const routeId of routeIds) {
    if (visited.has(routeId) || visited.size >= MAX_FAILOVER_ROUTES) continue;
    visited.add(routeId);
    try {
      return await run(routeId);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) throw error;
    }
  }
  throw lastError ?? new Error("No eligible free route remains.");
}

function stateFor(id: string): FreeRouteSnapshot {
  const current = routes.get(id);
  if (current) return current;
  const created = { id, failures: 0, cooldownUntil: 0, calls: 0 };
  routes.set(id, created);
  return created;
}

export function chooseFreeRoute(models: AiModel[], excluded: string[] = []) {
  const now = Date.now();
  const excludedSet = new Set(excluded);
  return models
    .filter((model) => model.enabled && model.free && !excludedSet.has(model.id))
    .filter((model) => stateFor(model.id).cooldownUntil <= now)
    .sort((a, b) => {
      const aState = stateFor(a.id);
      const bState = stateFor(b.id);
      return a.priority - b.priority || aState.failures - bState.failures;
    })[0];
}

export function recordFreeRouteSuccess(id: string) {
  const state = stateFor(id);
  state.calls += 1;
  state.failures = 0;
  state.cooldownUntil = 0;
  state.lastErrorCode = undefined;
}

export function recordFreeRouteFailure(id: string, errorCode: string) {
  const state = stateFor(id);
  state.calls += 1;
  state.failures += 1;
  state.lastErrorCode = errorCode;
  const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.max(0, state.failures - 1));
  state.cooldownUntil = Date.now() + cooldown;
}

export function getFreeRouteSnapshots(): FreeRouteSnapshot[] {
  return [...routes.values()].map((state) => ({ ...state }));
}

export function resetFreeRouteState() {
  routes.clear();
}
