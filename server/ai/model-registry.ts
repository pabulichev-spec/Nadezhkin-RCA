import { ENV } from "../_core/env";
import { isZeroCostModel } from "./cost-guard";
import { AiGatewayError, type AiModel } from "./types";
import { allowlistedModelIds, assertVerifiedFreeModel, isExplicitlyAllowlistedFreeId, roleForTask, type FreeAgentRole } from "./free-allowlist";

type OpenRouterModel = {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, string>;
  supported_parameters?: string[];
  context_length?: number;
};

let cache: { models: AiModel[]; expiresAt: number } | undefined;

const EXCLUDED_PROVIDER_PREFIXES = ["openai/", "anthropic/", "google/"];

function isPermittedFreeModelId(id: string) {
  const normalized = id.toLowerCase();
  return !EXCLUDED_PROVIDER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function toAiModel(model: OpenRouterModel, index: number): AiModel {
  const pricing = model.pricing ?? {};
  return {
    id: model.id,
    name: model.name,
    provider: "openrouter",
    free: isPermittedFreeModelId(model.id) && isZeroCostModel({
      id: model.id,
      provider: "openrouter",
      free: true,
      inputModalities: model.architecture?.input_modalities ?? [],
      outputModalities: model.architecture?.output_modalities ?? [],
      supportedParameters: model.supported_parameters ?? [],
      contextWindow: model.context_length,
      priority: index,
      enabled: true,
      pricing,
    }),
    inputModalities: model.architecture?.input_modalities ?? [],
    outputModalities: model.architecture?.output_modalities ?? [],
    supportedParameters: model.supported_parameters ?? [],
    contextWindow: model.context_length,
    priority: index,
    enabled: true,
    pricing,
  };
}

export async function listFreeModels(force = false): Promise<AiModel[]> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.models;
  const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=all", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new AiGatewayError("PROVIDER_UNAVAILABLE", `OpenRouter model registry returned HTTP ${response.status}.`, response.status);
  }
  const payload = (await response.json()) as { data?: OpenRouterModel[] };
  const models = (payload.data ?? []).map(toAiModel).filter((model) => model.free);
  cache = { models, expiresAt: Date.now() + 5 * 60_000 };
  return models;
}

export function configuredModelId(task: "general" | "reasoning" | "vision") {
  if (task === "vision") return ENV.openRouterVisionModel || "openrouter/free";
  if (task === "reasoning") return ENV.openRouterReasoningModel || "openrouter/free";
  return ENV.openRouterGeneralModel || "openrouter/free";
}

const VISION_EXCLUDED_TERMS = ["safety", "moderation", "classifier", "reranker", "embedding", "guard", "content-safety"];

export function isVisionCandidate(model: AiModel, needsStructuredOutput: boolean) {
  const id = model.id.toLowerCase();
  const supportsTextGeneration = model.outputModalities.includes("text") && (model.supportedParameters.includes("max_tokens") || model.supportedParameters.includes("max_completion_tokens"));
  const supportsStructured = !needsStructuredOutput || model.supportedParameters.includes("structured_outputs") || model.supportedParameters.includes("response_format");
  // Current Video Agent sends extracted still frames as image_url parts, not raw video streams.
  const supportsVisualInput = model.inputModalities.includes("image");
  return supportsVisualInput && model.inputModalities.includes("text") && supportsTextGeneration && supportsStructured && !VISION_EXCLUDED_TERMS.some((term) => id.includes(term));
}

export async function resolveFreeModel(task: "general" | "reasoning" | "vision", needsVision = false, needsStructuredOutput = false, excludeModels: string[] = [], requestedModel?: string, agentRole?: FreeAgentRole) {
  const role: FreeAgentRole = needsVision ? "vision" : agentRole ?? roleForTask(task);
  const requested = requestedModel && requestedModel !== "openrouter/free" ? requestedModel : undefined;
  if (requested && !isExplicitlyAllowlistedFreeId(requested)) {
    throw new AiGatewayError("REQUEST_BLOCKED_BY_ZERO_COST_POLICY", `Model ${requested} is not in the explicit free allowlist.`);
  }
  const allowedIds = requested ? [requested] : [...allowlistedModelIds(role)];
  const models = await listFreeModels();
  for (const id of allowedIds) {
    if (excludeModels.includes(id)) continue;
    const model = models.find((item) => item.id === id);
    if (!model) continue;
    assertVerifiedFreeModel(model, role);
    if (needsVision && !isVisionCandidate(model, needsStructuredOutput)) continue;
    if (!needsVision && (!model.inputModalities.includes("text") || !model.outputModalities.includes("text"))) continue;
    if (needsStructuredOutput && !model.supportedParameters.includes("structured_outputs") && !model.supportedParameters.includes("response_format")) continue;
    return model;
  }
  throw new AiGatewayError(needsVision ? "VISION_UNAVAILABLE_FOR_CURRENT_FREE_POOL" : "MODEL_UNAVAILABLE", `No verified allowlisted free model is available for role ${role}.`);
}
