import { ENV } from "../_core/env";
import { callOmniRoute, getOmniRouteFreeModelIds, isOmniRouteConfigured } from "./omniroute-provider";
import { callOpenRouter } from "./openrouter-provider";
import { recordFreeRouteFailure, recordFreeRouteSuccess, runFreeRouteFailover } from "./free-pool";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";

const FALLBACKABLE_ERRORS = new Set([
  "FREE_QUOTA_EXCEEDED",
  "MODEL_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "INVALID_AI_RESPONSE",
]);

function canUseOmniRoute() {
  return ENV.omniRouteEnabled && ENV.omniRouteZeroCostConfirmed && isOmniRouteConfigured();
}

export function isVisionRequest(request: AiRequest) {
  return request.task === "PHOTO_ANALYSIS" || request.task === "VIDEO_ANALYSIS" || request.task === "DOCUMENT_ANALYSIS" || request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url" || part.type === "video_url" || part.type === "file"));
}

export async function callFreeProvider(request: AiRequest): Promise<AiResponse> {
  const excluded = [...(request.excludeModels ?? [])];
  // The current OmniRoute adapter is text-only. Vision remains on the existing
  // capability-filtered OpenRouter free pool rather than failing closed.
  if (canUseOmniRoute() && !isVisionRequest(request)) {
    const omniRoutes = getOmniRouteFreeModelIds().filter((model) => !excluded.includes(model));
    try {
      return await runFreeRouteFailover(omniRoutes, async (model) => {
        const response = await callOmniRoute({ ...request, model, excludeModels: excluded });
        recordFreeRouteSuccess(model);
        return response;
      }, (error) => {
        if (!(error instanceof AiGatewayError)) return true;
        const model = error.modelId;
        if (model) recordFreeRouteFailure(model, error.code);
        return FALLBACKABLE_ERRORS.has(error.code);
      });
    } catch (error) {
      if (error instanceof AiGatewayError && !FALLBACKABLE_ERRORS.has(error.code)) throw error;
    }
  }
  let lastError: unknown;
  try {
    const response = await callOpenRouter({ ...request, excludeModels: excluded });
    recordFreeRouteSuccess(response.model);
    return response;
  } catch (error) {
    lastError = error;
  }
  throw lastError instanceof Error ? lastError : new AiGatewayError("PROVIDER_UNAVAILABLE", "No eligible free AI route is available.");
}

export function getFreeProviderStatus() {
  return {
    omniRouteEnabled: ENV.omniRouteEnabled,
    omniRouteConfigured: canUseOmniRoute(),
    omniRouteModelCount: canUseOmniRoute() ? ENV.omniRouteFreeModels.length : 0,
    openRouterAvailable: Boolean(ENV.openRouterApiKey),
    zeroCostOnly: true,
  };
}
