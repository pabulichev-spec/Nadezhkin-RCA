export type AiTaskType =
  | "CHAT"
  | "RCA"
  | "ROOT_CAUSE_ANALYSIS"
  | "FIVE_WHY"
  | "CAUSE_TREE"
  | "SYMPTOM_ANALYSIS"
  | "DATA_ANALYSIS"
  | "FAILURE_ANALYSIS"
  | "PHOTO_ANALYSIS"
  | "VIDEO_ANALYSIS"
  | "DOCUMENT_ANALYSIS"
  | "SMART_ACTIONS"
  | "REPORT_GENERATION"
  | "KNOWLEDGE_SEARCH"
  | "EQUIPMENT_ANALYSIS"
  | "INVESTIGATION_SUMMARY";

export type AiMessageContent = string | Array<{
  type: "text" | "image_url" | "video_url" | "file";
  text?: string;
  image_url?: { url: string; detail?: "low" | "high" | "auto" };
  video_url?: { url: string };
  file?: { filename: string; file_data: string };
}>;

export type AiMessage = { role: "system" | "user" | "assistant"; content: AiMessageContent };

export type AiModel = {
  id: string;
  name?: string;
  provider: string;
  free: boolean;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  contextWindow?: number;
  priority: number;
  enabled: boolean;
  pricing: Record<string, string>;
};

export type AiRequest = {
  task: AiTaskType;
  agentRole?: "analyst" | "critic" | "composer" | "reserve" | "vision";
  messages: AiMessage[];
  model?: string;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  excludeModels?: string[];
  /** Photo evidence is analyzed by the dedicated Photo Agent before RCA synthesis. */
  photoImages?: Array<{ evidenceRef: string; imageData: string; note?: string }>;
  /** Extracted video frames are kept server-side for the dedicated Video Agent, never sent as a raw video URL. */
  videoFrames?: Array<{ evidenceRef: string; timestampMs: number; imageData: string; note?: string }>;
  /** Uploaded documents are routed through the dedicated Document Agent before RCA synthesis. */
  documentFiles?: Array<{ evidenceRef: string; mimeType: string; fileData: string; note?: string }>;
};

export type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost: 0;
};

export type AiResponse = {
  content: string;
  model: string;
  usage: AiUsage;
  provider: "openrouter" | "omniroute";
};

export class AiGatewayError extends Error {
  constructor(
    public readonly code:
      | "OPENROUTER_NOT_CONFIGURED"
      | "FREE_QUOTA_EXCEEDED"
      | "MODEL_UNAVAILABLE"
      | "VISION_UNAVAILABLE_FOR_CURRENT_FREE_POOL"
      | "REQUEST_BLOCKED_BY_ZERO_COST_POLICY"
      | "PROVIDER_UNAVAILABLE"
      | "INVALID_AI_RESPONSE",
    message: string,
    public readonly status?: number,
    public readonly modelId?: string,
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}
