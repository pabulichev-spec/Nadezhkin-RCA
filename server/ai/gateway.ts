import { ENV } from "../_core/env";
import { listFreeModels } from "./model-registry";
import { normalizeAndValidateVision } from "./rca-validator";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";
import { VISION_RESPONSE_FORMAT, withVisionContractMessages } from "./vision-contract";
import { callFreeProvider, getFreeProviderStatus } from "./provider-router";

export async function runAiGateway(request: AiRequest): Promise<AiResponse> {
  // Every route is explicitly free-only; paid or unknown providers are never called.
  if (request.task !== "PHOTO_ANALYSIS") return callFreeProvider(request);

  const visionResponseFormat = request.responseFormat ?? VISION_RESPONSE_FORMAT;
  let lastError: unknown;
  const excludedModels = [...(request.excludeModels ?? [])];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callFreeProvider({
        ...request,
        messages: withVisionContractMessages(request.messages),
        excludeModels: excludedModels,
        responseFormat: visionResponseFormat,
      });
      excludedModels.push(response.model);
      const normalized = normalizeAndValidateVision(response.content);
      return { ...response, content: JSON.stringify(normalized) };
    } catch (error) {
      lastError = error;
      if (error instanceof AiGatewayError && error.modelId && !excludedModels.includes(error.modelId)) {
        excludedModels.push(error.modelId);
      }
    }
  }
  if (lastError instanceof AiGatewayError && ["INVALID_AI_RESPONSE", "MODEL_UNAVAILABLE"].includes(lastError.code)) {
    throw new AiGatewayError("VISION_UNAVAILABLE_FOR_CURRENT_FREE_POOL", "No compatible free vision model returned a valid image analysis after one retry.");
  }
  throw lastError;
}

export async function getAiGatewayStatus() {
  const routing = getFreeProviderStatus();
  if (!ENV.openRouterApiKey && !routing.omniRouteConfigured) {
    return { status: "NOT_CONFIGURED" as const, provider: "OpenRouter/OmniRoute", zeroCostOnly: true, modelCount: 0, routing };
  }
  try {
    const models = await listFreeModels();
    return { status: models.length || routing.omniRouteConfigured ? "ONLINE" as const : "LIMITED" as const, provider: "OpenRouter/OmniRoute", zeroCostOnly: true, modelCount: models.length, routing };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "LIMITED" as const, provider: "OpenRouter/OmniRoute", zeroCostOnly: true, modelCount: 0, message, routing };
  }
}

export function aiErrorMessage(error: unknown) {
  if (error instanceof AiGatewayError) return { code: error.code, message: error.message, status: error.status };
  return { code: "PROVIDER_UNAVAILABLE", message: "Бесплатная AI-модель временно недоступна. Попробуйте повторить позже." };
}
