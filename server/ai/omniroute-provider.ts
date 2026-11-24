import { ENV } from "../_core/env";
import { assertTaskCapability } from "./cost-guard";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";
import { isExplicitlyAllowlistedFreeId } from "./free-allowlist";

type OmniRouteBody = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function parseError(status: number, body: string, modelId: string): AiGatewayError {
  if (status === 401 || status === 403) return new AiGatewayError("PROVIDER_UNAVAILABLE", "OmniRoute authorization is unavailable.", status, modelId);
  if (status === 429) return new AiGatewayError("FREE_QUOTA_EXCEEDED", "OmniRoute free route quota is temporarily exhausted.", status, modelId);
  if (status === 404) return new AiGatewayError("MODEL_UNAVAILABLE", "The configured OmniRoute free route is unavailable.", status, modelId);
  return new AiGatewayError("PROVIDER_UNAVAILABLE", body.slice(0, 500) || `OmniRoute HTTP ${status}.`, status, modelId);
}

export function getOmniRouteFreeModelIds() {
  return ENV.omniRouteFreeModels.filter(isExplicitlyAllowlistedFreeId);
}

export function isOmniRouteConfigured() {
  return Boolean(ENV.omniRouteBaseUrl && ENV.omniRouteApiKey && getOmniRouteFreeModelIds().length > 0);
}

export async function callOmniRoute(request: AiRequest): Promise<AiResponse> {
  if (!isOmniRouteConfigured()) throw new AiGatewayError("PROVIDER_UNAVAILABLE", "OmniRoute free routes are not configured.");
  const requested = request.model ?? ENV.omniRouteFreeModels[0];
  if (!requested || !isExplicitlyAllowlistedFreeId(requested) || !ENV.omniRouteFreeModels.includes(requested)) {
    throw new AiGatewayError("REQUEST_BLOCKED_BY_ZERO_COST_POLICY", "OmniRoute requires an explicitly allowlisted free model route.", undefined, requested);
  }
  const model = {
    id: requested,
    provider: "omniroute",
    free: true,
    inputModalities: ["text"] as string[],
    outputModalities: ["text"] as string[],
    supportedParameters: request.responseFormat ? ["response_format", "structured_outputs"] : [],
    priority: 0,
    enabled: true,
    pricing: { prompt: "0", completion: "0", request: "0", image: "0", internal_reasoning: "0" },
  } as const;
  const needsVision = request.task === "PHOTO_ANALYSIS" || request.task === "VIDEO_ANALYSIS" || request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
  assertTaskCapability(model, needsVision, Boolean(request.responseFormat));
  const payload: Record<string, unknown> = {
    model: requested,
    messages: request.messages,
    max_tokens: request.maxTokens ?? 2400,
  };
  if (request.responseFormat) payload.response_format = request.responseFormat;
  if (request.reasoning) payload.reasoning = request.reasoning;
  const response = await fetch(`${ENV.omniRouteBaseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.omniRouteApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.text();
  if (!response.ok) throw parseError(response.status, rawBody, requested);
  let body: OmniRouteBody;
  try {
    body = JSON.parse(rawBody) as OmniRouteBody;
  } catch {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "OmniRoute returned invalid JSON.", undefined, requested);
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiGatewayError("INVALID_AI_RESPONSE", "OmniRoute returned an empty response.", undefined, requested);
  return {
    content: content.trim(),
    model: body.model ?? requested,
    provider: "omniroute",
    usage: {
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
      totalTokens: body.usage?.total_tokens,
      cost: 0,
    },
  };
}
