import { describe, expect, it } from "vitest";
import { allowlistedModelIds, assertVerifiedFreeModel, isExplicitlyAllowlistedFreeId } from "../server/ai/free-allowlist";
import type { AiModel } from "../server/ai/types";

const model = (id: string, inputModalities = ["text"]): AiModel => ({
  id,
  provider: "openrouter",
  free: true,
  inputModalities,
  outputModalities: ["text"],
  supportedParameters: ["response_format", "structured_outputs"],
  priority: 0,
  enabled: true,
  pricing: { prompt: "0", completion: "0" },
});

describe("explicit free model allowlist", () => {
  it("prioritizes the currently verified free text route for RCA and reserve traffic", () => {
    const verifiedRoute = "dots-studio/dots-3-note-preview:free";
    expect(allowlistedModelIds("analyst")[0]).toBe(verifiedRoute);
    expect(allowlistedModelIds("critic")[0]).toBe(verifiedRoute);
    expect(allowlistedModelIds("composer")[0]).toBe(verifiedRoute);
    expect(allowlistedModelIds("reserve")[0]).toBe(verifiedRoute);
    expect(Object.values({
      analyst: allowlistedModelIds("analyst"),
      critic: allowlistedModelIds("critic"),
      composer: allowlistedModelIds("composer"),
      reserve: allowlistedModelIds("reserve"),
    }).flat()).not.toContain("recursive/flint-v1.0:free");
  });

  it("contains only the approved non-Google candidate IDs", () => {
    const ids = Object.values({
      analyst: allowlistedModelIds("analyst"),
      critic: allowlistedModelIds("critic"),
      composer: allowlistedModelIds("composer"),
      reserve: allowlistedModelIds("reserve"),
      vision: allowlistedModelIds("vision"),
    }).flat();
    expect(ids).not.toContain("google/gemma-4-26b-a4b-it:free");
    expect(ids.every((id) => !/^(openai|anthropic|google)\//.test(id))).toBe(true);
    expect(ids).toContain("nvidia/nemotron-3.5-super-vl:free");
    expect(ids).not.toContain("nvidia/nemotron-3-super-120b-a12b:free");
    expect(ids).not.toContain("poolside/laguna-s-2.1:free");
  });

  it("rejects unknown or paid IDs before provider use", () => {
    expect(isExplicitlyAllowlistedFreeId("unknown/model:free")).toBe(false);
    expect(() => assertVerifiedFreeModel(model("unknown/model:free"), "analyst")).toThrow("explicit free allowlist");
    expect(() => assertVerifiedFreeModel({ ...model(allowlistedModelIds("analyst")[0]), free: false }, "analyst")).toThrow("verified zero");
  });

  it("rejects missing or non-zero prompt/completion pricing", () => {
    const id = allowlistedModelIds("critic")[0];
    expect(() => assertVerifiedFreeModel({ ...model(id), pricing: { prompt: "0" } }, "critic")).toThrow("verified zero");
    expect(() => assertVerifiedFreeModel({ ...model(id), pricing: { prompt: "0", completion: "0.000001" } }, "critic")).toThrow("verified zero");
  });

  it("requires image input for the Vision role", () => {
    const id = allowlistedModelIds("vision")[0];
    expect(() => assertVerifiedFreeModel(model(id), "vision")).toThrow("image or video input");
    expect(() => assertVerifiedFreeModel(model(id, ["text", "image"]), "vision")).not.toThrow();
  });

  it("accepts video-capable free vision routes", () => {
    const id = "nvidia/nemotron-3.5-super-vl:free";
    expect(() => assertVerifiedFreeModel(model(id, ["text", "video"]), "vision")).not.toThrow();
    expect(() => assertVerifiedFreeModel(model(id, ["text", "image", "video"]), "vision")).not.toThrow();
  });
});
