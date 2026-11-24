import { describe, expect, it, vi } from "vitest";
import { assertTaskCapability, isZeroCostModel } from "../server/ai/cost-guard";
import { allowlistedModelIds } from "../server/ai/free-allowlist";
import { callOpenRouter } from "../server/ai/openrouter-provider";
import { AiGatewayError, type AiModel } from "../server/ai/types";

const model = (pricing: Record<string, string>, free = true): AiModel => ({
  id: "test/model",
  provider: "openrouter",
  free,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  supportedParameters: ["structured_outputs"],
  priority: 0,
  enabled: true,
  pricing,
});

describe("AI Gateway zero-cost policy", () => {
  it("accepts a model whose relevant pricing fields are zero", () => {
    expect(isZeroCostModel(model({ prompt: "0", completion: "0", request: "0", image: "0" }))).toBe(true);
    expect(() => assertTaskCapability(model({ prompt: "0", completion: "0", request: "0", image: "0" }), true, true)).not.toThrow();
  });

  it("blocks a model with any non-zero price", () => {
    expect(isZeroCostModel(model({ prompt: "0", completion: "0.000001" }))).toBe(false);
    expect(() => assertTaskCapability(model({ prompt: "0", completion: "0.000001" }), false, false)).toThrowError(AiGatewayError);
    try {
      assertTaskCapability(model({ prompt: "0", completion: "0.000001" }), false, false);
    } catch (error) {
      expect((error as AiGatewayError).code).toBe("REQUEST_BLOCKED_BY_ZERO_COST_POLICY");
    }
  });

  it("blocks a non-free model even when its pricing object is empty", () => {
    expect(() => assertTaskCapability(model({}, false), false, false)).toThrowError(AiGatewayError);
  });

  it("blocks unknown prompt or completion pricing instead of assuming zero", () => {
    expect(isZeroCostModel(model({ request: "0" }))).toBe(false);
    expect(isZeroCostModel(model({ prompt: "0" }))).toBe(false);
    expect(() => assertTaskCapability(model({ prompt: "0" }), false, false)).toThrowError(AiGatewayError);
  });

  it("requires image capability for vision tasks", () => {
    expect(() => assertTaskCapability({ ...model({ prompt: "0", completion: "0" }), inputModalities: ["text"] }, true, false)).toThrowError(/image input/);
  });

  it("accepts the free multimodal capability used for video frames and documents", () => {
    expect(() => assertTaskCapability({ ...model({ prompt: "0", completion: "0" }), inputModalities: ["text", "image", "video"] }, true, true)).not.toThrow();
  });

  it("tries every bounded free route after consecutive provider 429 responses", async () => {
    const routes = allowlistedModelIds("reserve");
    expect(routes).toContain("nvidia/nemotron-3.5-lightning:free");
    expect(routes).not.toContain("poolside/laguna-s-2.1:free");
    const postModels: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/models")) {
        return new Response(JSON.stringify({
          data: routes.map((id) => ({
            id,
            architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["response_format", "max_tokens"],
          })),
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      const body = JSON.parse(String(init?.body)) as { model?: string };
      postModels.push(body.model ?? "");
      if (postModels.length < routes.length) {
        return new Response(JSON.stringify({ error: { code: 429 } }), { status: 429, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "READY" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await callOpenRouter({
      task: "CHAT",
      agentRole: "reserve",
      messages: [{ role: "user", content: "Reply READY only." }],
      maxTokens: 8,
    });

    expect(postModels).toEqual(routes);
    expect(result.model).toBe(routes.at(-1));
    expect(result.usage?.cost).toBe(0);
  });

  it("retries a transient 503 on the same free route before failing over", async () => {
    const routes = ["nvidia/nemotron-3.5-lightning:free"];
    let completionCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v1/models")) {
        return new Response(JSON.stringify({
          data: routes.map((id) => ({
            id,
            architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["max_tokens"],
          })),
        }), { status: 200 });
      }
      completionCalls += 1;
      if (completionCalls === 1) return new Response("temporarily unavailable", { status: 503 });
      const body = JSON.parse(String(init?.body)) as { model?: string };
      return new Response(JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "READY" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 });
    });

    const result = await callOpenRouter({
      task: "CHAT",
      agentRole: "reserve",
      model: routes[0],
      messages: [{ role: "user", content: "Reply READY only." }],
      maxTokens: 8,
    });

    expect(completionCalls).toBe(2);
    expect(result.model).toBe(routes[0]);
    expect(result.usage?.cost).toBe(0);
  });
});
