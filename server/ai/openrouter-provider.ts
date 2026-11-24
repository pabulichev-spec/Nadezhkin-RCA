import { ENV } from "../_core/env";
import { assertTaskCapability } from "./cost-guard";
import { resolveFreeModel } from "./model-registry";
import { allowlistedModelIds, roleForTask } from "./free-allowlist";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";

// A registry/provider race can briefly make an allowlisted route fail the
// zero-cost assertion after it was selected.  It is safe to fail over here:
// resolveFreeModel still requires the next route to be explicitly allowlisted
// and verified free before any request is sent.
const FALLBACKABLE_ERRORS = new Set(["FREE_QUOTA_EXCEEDED", "MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "INVALID_AI_RESPONSE", "REQUEST_BLOCKED_BY_ZERO_COST_POLICY"]);
const TRANSIENT_PROVIDER_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_RETRIES = 2;

function waitForTransientRetry(attempt: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
}

function isVisionRequest(request: AiRequest) {
  return request.task === "PHOTO_ANALYSIS" || request.task === "VIDEO_ANALYSIS" || request.task === "DOCUMENT_ANALYSIS" || request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url" || part.type === "video_url" || part.type === "file"));
}

function parseProviderError(status: number, body: string, modelId?: string): AiGatewayError {
  if (status === 401 || status === 403) return new AiGatewayError("PROVIDER_UNAVAILABLE", "OpenRouter authorization is unavailable.", status, modelId);
  if (status === 429) return new AiGatewayError("FREE_QUOTA_EXCEEDED", "Free AI quota is temporarily exhausted.", status, modelId);
  if (status === 404) return new AiGatewayError("MODEL_UNAVAILABLE", "The selected free model is unavailable.", status, modelId);
  return new AiGatewayError("PROVIDER_UNAVAILABLE", body.slice(0, 500) || `OpenRouter HTTP ${status}.`, status, modelId);
}

async function callOpenRouterOnce(request: AiRequest): Promise<AiResponse> {
  const vision = isVisionRequest(request);
  const model = await resolveFreeModel(vision ? "vision" : request.task === "RCA" || request.task === "ROOT_CAUSE_ANALYSIS" ? "reasoning" : "general", vision, Boolean(request.responseFormat), request.excludeModels, request.model, request.agentRole);
  assertTaskCapability(model, vision, Boolean(request.responseFormat));

  const payload: Record<string, unknown> = {
    model: model.id,
    messages: request.messages,
    max_tokens: request.maxTokens ?? 2400,
  };
  if (request.responseFormat) payload.response_format = request.responseFormat;
  if (request.responseFormat) payload.provider = { require_parameters: true };
  if (request.reasoning) payload.reasoning = request.reasoning;
  const includesPdf = request.task === "DOCUMENT_ANALYSIS" && request.messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part) =>
      part.type === "file" && typeof part.file?.file_data === "string" && part.file.file_data.startsWith("data:application/pdf;base64,"),
    ),
  );
  // OpenRouter's Mistral OCR parser is paid. Pin PDF extraction to Cloudflare AI,
  // which OpenRouter documents as free, so PDF analysis cannot silently incur OCR charges.
  if (includesPdf) payload.plugins = [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }];

  let response: Response | undefined;
  let rawBody = "";
  for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt += 1) {
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://pumprca.app",
          "X-Title": "Nadezhkin Reliability Control Center",
        },
        body: JSON.stringify(payload),
      });
      rawBody = await response.text();
      if (!TRANSIENT_PROVIDER_STATUSES.has(response.status) || attempt === TRANSIENT_RETRIES) break;
    } catch {
      if (attempt === TRANSIENT_RETRIES) {
        throw new AiGatewayError("PROVIDER_UNAVAILABLE", "OpenRouter request timed out or could not be reached.", undefined, model.id);
      }
    }
    await waitForTransientRetry(attempt);
  }

  if (!response) throw new AiGatewayError("PROVIDER_UNAVAILABLE", "OpenRouter request did not return a response.", undefined, model.id);
  if (!response.ok) throw parseProviderError(response.status, rawBody, model.id);

  let body: { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "OpenRouter returned invalid JSON.", undefined, model.id);
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiGatewayError("INVALID_AI_RESPONSE", "OpenRouter returned an empty response.", undefined, model.id);

  return {
    content: content.trim(),
    model: body.model ?? model.id,
    provider: "openrouter",
    usage: {
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
      totalTokens: body.usage?.total_tokens,
      cost: 0,
    },
  };
}

export async function callOpenRouter(request: AiRequest): Promise<AiResponse> {
  if (!ENV.openRouterApiKey) {
    throw new AiGatewayError("OPENROUTER_NOT_CONFIGURED", "OpenRouter API is not configured on the server.");
  }

  const excludedModels = [...(request.excludeModels ?? [])];
  let lastError: unknown;
  const role = request.agentRole ?? roleForTask(isVisionRequest(request) ? "PHOTO_ANALYSIS" : request.task);
  const maxAttempts = Math.max(1, allowlistedModelIds(role).length);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await callOpenRouterOnce({
        ...request,
        model: attempt === 0 ? request.model : undefined,
        excludeModels: excludedModels,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof AiGatewayError) || !FALLBACKABLE_ERRORS.has(error.code)) throw error;
      const failedModel = error.modelId ?? (attempt === 0 ? request.model : undefined);
      if (failedModel && !excludedModels.includes(failedModel)) excludedModels.push(failedModel);
    }
  }
  throw lastError instanceof Error ? lastError : new AiGatewayError("PROVIDER_UNAVAILABLE", "No verified allowlisted free model is available.");
}
