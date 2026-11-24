import { beforeEach, describe, expect, it } from "vitest";
import { chooseFreeRoute, getFreeRouteSnapshots, recordFreeRouteFailure, recordFreeRouteSuccess, resetFreeRouteState, runFreeRouteFailover } from "../server/ai/free-pool";
import type { AiModel } from "../server/ai/types";

const model = (id: string, priority: number): AiModel => ({
  id,
  provider: "test",
  free: true,
  inputModalities: ["text"],
  outputModalities: ["text"],
  supportedParameters: [],
  priority,
  enabled: true,
  pricing: { prompt: "0", completion: "0", request: "0" },
});

describe("free route registry", () => {
  beforeEach(() => resetFreeRouteState());

  it("selects the highest-priority eligible route and honors exclusions", () => {
    const models = [model("second", 2), model("first", 1)];
    expect(chooseFreeRoute(models)?.id).toBe("first");
    expect(chooseFreeRoute(models, ["first"])?.id).toBe("second");
  });

  it("puts a failed route on cooldown and does not treat quota as a paid fallback", () => {
    const models = [model("quota-route", 1), model("safe-route", 2)];
    recordFreeRouteFailure("quota-route", "FREE_QUOTA_EXCEEDED");
    expect(chooseFreeRoute(models)?.id).toBe("safe-route");
    expect(getFreeRouteSnapshots().find((route) => route.id === "quota-route")).toMatchObject({ id: "quota-route", lastErrorCode: "FREE_QUOTA_EXCEEDED", failures: 1 });
  });

  it("resets failure state after a successful free call", () => {
    recordFreeRouteFailure("route", "PROVIDER_UNAVAILABLE");
    recordFreeRouteSuccess("route");
    expect(getFreeRouteSnapshots()[0]).toMatchObject({ id: "route", failures: 0, cooldownUntil: 0, calls: 2 });
  });

  it("never selects disabled or non-free routes", () => {
    const disabled = { ...model("disabled", 1), enabled: false };
    const paid = { ...model("paid", 2), free: false };
    expect(chooseFreeRoute([disabled, paid])).toBeUndefined();
  });

  it("continues the same context from route A after 429 onto route B", async () => {
    const context = { investigationId: "case-1", facts: ["vibration 8.4 mm/s"], remaining: ["verify alignment"] };
    const seen: Array<{ route: string; context: typeof context }> = [];
    const result = await runFreeRouteFailover(["A", "B"], async (route) => {
      seen.push({ route, context });
      if (route === "A") throw { status: 429, code: "FREE_QUOTA_EXCEEDED" };
      return { route, context };
    }, () => true);
    expect(result.route).toBe("B");
    expect(seen).toHaveLength(2);
    expect(seen[1].context).toEqual(context);
  });

  it("continues after a transient zero-cost policy mismatch without using a paid route", async () => {
    const context = { investigationId: "case-zero-cost", stage: "analyst", evidenceRefs: ["shift-log"] };
    const seen: string[] = [];
    const result = await runFreeRouteFailover(["allowlisted-A", "allowlisted-B"], async (route) => {
      seen.push(route);
      if (route === "allowlisted-A") throw { code: "REQUEST_BLOCKED_BY_ZERO_COST_POLICY" };
      return { route, context };
    }, (error) => (error as { code?: string }).code === "REQUEST_BLOCKED_BY_ZERO_COST_POLICY");
    expect(seen).toEqual(["allowlisted-A", "allowlisted-B"]);
    expect(result).toEqual({ route: "allowlisted-B", context });
    expect(seen).not.toContain("paid-route");
  });

  it("stops after unique routes and does not loop forever", async () => {
    let calls = 0;
    await expect(runFreeRouteFailover(["A", "A", "B"], async () => {
      calls += 1;
      throw new Error("temporary failure");
    }, () => true)).rejects.toThrow("temporary failure");
    expect(calls).toBe(2);
  });
});
