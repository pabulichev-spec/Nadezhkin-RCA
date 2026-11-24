import { afterEach, describe, expect, it, vi } from "vitest";
import { callOpenRouter } from "../server/ai/openrouter-provider";
import { allowlistedModelIds } from "../server/ai/free-allowlist";

const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "document_test",
    strict: true,
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
};

afterEach(() => vi.restoreAllMocks());

describe("Document Agent OpenRouter routing", () => {
  it("pins PDF parsing to the free Cloudflare AI engine", async () => {
    let completionPayload: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/v1/models")) {
        return new Response(JSON.stringify({
          data: allowlistedModelIds("vision").map((id) => ({
            id,
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["response_format", "max_tokens"],
          })),
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      completionPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: allowlistedModelIds("vision")[0],
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await callOpenRouter({
      task: "DOCUMENT_ANALYSIS",
      agentRole: "vision",
      model: allowlistedModelIds("vision")[0],
      messages: [{ role: "user", content: [
        { type: "text", text: "Analyze this PDF" },
        { type: "file", file: { filename: "maintenance.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } },
      ] }],
      responseFormat,
      maxTokens: 100,
    });

    expect(completionPayload?.plugins).toEqual([{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
    expect(completionPayload?.model).toBe(allowlistedModelIds("vision")[0]);
  });

  it("does not enable a PDF parser for text-only document analysis", async () => {
    let completionPayload: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/v1/models")) {
        return new Response(JSON.stringify({
          data: allowlistedModelIds("vision").map((id) => ({
            id,
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["response_format", "max_tokens"],
          })),
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      completionPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ model: allowlistedModelIds("vision")[0], choices: [{ message: { content: "{}" } }] }), { status: 200 });
    });

    await callOpenRouter({
      task: "DOCUMENT_ANALYSIS",
      agentRole: "vision",
      model: allowlistedModelIds("vision")[0],
      messages: [{ role: "user", content: [{ type: "text", text: "Analyze extracted text" }] }],
      responseFormat,
      maxTokens: 100,
    });

    expect(completionPayload?.plugins).toBeUndefined();
  });
});
