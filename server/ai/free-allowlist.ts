import { AiGatewayError, type AiModel } from "./types";

export type FreeAgentRole = "analyst" | "critic" | "composer" | "reserve" | "vision";

export const FREE_MODEL_ALLOWLIST: Readonly<Record<FreeAgentRole, readonly string[]>> = {
  // Exact free-only IDs. Every request is re-checked against the live registry and pricing.
  analyst: ["dots-studio/dots-3-note-preview:free", "xingchen-agi/xing4.0-29b-a4b:free", "liquid/lfm-2.5-2.6b:free"],
  critic: ["dots-studio/dots-3-note-preview:free", "liquid/lfm-2.5-2.6b:free", "xingchen-agi/xing4.0-29b-a4b:free"],
  composer: ["dots-studio/dots-3-note-preview:free", "xingchen-agi/xing4.0-29b-a4b:free", "liquid/lfm-2.5-2.6b:free"],
  // Text reserve routes; stale 404 IDs are deliberately not kept here.
  reserve: [
    "dots-studio/dots-3-note-preview:free",
    "xingchen-agi/xing4.0-29b-a4b:free",
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free",
  ],
  // Super VL accepts text, image and video and supports structured output.
  // Dots3 remains the image-capable fallback for photo/document-parser traffic.
  vision: ["nvidia/nemotron-3.5-super-vl:free", "dots-studio/dots-3-note-preview:free"],
};

const ALL_ALLOWLISTED_IDS = new Set(Object.values(FREE_MODEL_ALLOWLIST).flat());

export function allowlistedModelIds(role: FreeAgentRole): readonly string[] {
  return FREE_MODEL_ALLOWLIST[role];
}

export function isExplicitlyAllowlistedFreeId(id: string) {
  return ALL_ALLOWLISTED_IDS.has(id);
}

export function assertVerifiedFreeModel(model: AiModel, role: FreeAgentRole) {
  if (!allowlistedModelIds(role).includes(model.id)) {
    throw new AiGatewayError("REQUEST_BLOCKED_BY_ZERO_COST_POLICY", `Model ${model.id} is not in the explicit free allowlist.`);
  }
  if (!model.free || model.pricing.prompt !== "0" || model.pricing.completion !== "0") {
    throw new AiGatewayError("REQUEST_BLOCKED_BY_ZERO_COST_POLICY", `Model ${model.id} does not have verified zero prompt/completion pricing.`);
  }
  if (role === "vision" && !model.inputModalities.some((modality) => modality === "image" || modality === "video")) {
    throw new AiGatewayError("MODEL_UNAVAILABLE", `Model ${model.id} is not verified for image or video input.`, undefined, model.id);
  }
}

export function roleForTask(task: string): FreeAgentRole {
  if (task === "PHOTO_ANALYSIS" || task === "VIDEO_ANALYSIS" || task === "DOCUMENT_ANALYSIS") return "vision";
  if (task === "RCA" || task === "ROOT_CAUSE_ANALYSIS") return "composer";
  return "reserve";
}
