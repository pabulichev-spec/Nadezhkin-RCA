import { AiGatewayError, type AiModel } from "./types";

export const ZERO_COST_ONLY = true;

const PRICE_FIELDS = [
  "prompt",
  "completion",
  "request",
  "image",
  "web_search",
  "internal_reasoning",
  "input_cache_read",
  "input_cache_write",
] as const;

function isZeroPrice(value: unknown) {
  if (value === undefined || value === null || value === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

export function isZeroCostModel(model: AiModel) {
  const requiredPricing = ["prompt", "completion"] as const;
  if (!requiredPricing.every((field) => isZeroPrice(model.pricing[field]))) return false;
  return PRICE_FIELDS.slice(2).every((field) => {
    const value = model.pricing[field];
    return value === undefined || value === null || value === "" || isZeroPrice(value);
  });
}

export function assertZeroCostModel(model: AiModel) {
  if (!ZERO_COST_ONLY || !model.free || !isZeroCostModel(model)) {
    throw new AiGatewayError(
      "REQUEST_BLOCKED_BY_ZERO_COST_POLICY",
      `Model ${model.id} is not eligible for ZERO_COST_ONLY mode.`,
    );
  }
}

export function assertTaskCapability(model: AiModel, needsVision: boolean, needsStructuredOutput: boolean) {
  assertZeroCostModel(model);
  if (!model.enabled) {
    throw new AiGatewayError("MODEL_UNAVAILABLE", `Model ${model.id} is disabled.`);
  }
  if (needsVision && !model.inputModalities.includes("image")) {
    throw new AiGatewayError("MODEL_UNAVAILABLE", `Model ${model.id} does not support image input.`);
  }
  if (needsStructuredOutput && !model.supportedParameters.includes("structured_outputs") && !model.supportedParameters.includes("response_format")) {
    throw new AiGatewayError("MODEL_UNAVAILABLE", `Model ${model.id} does not support structured output.`);
  }
}
