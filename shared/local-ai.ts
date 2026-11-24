export const LOCAL_MODEL = {
  id: "qwen3-4b-q4_k_m",
  displayName: "Qwen3-4B Q4_K_M",
  source: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true",
  license: "Apache-2.0",
  fileName: "Qwen3-4B-Q4_K_M.gguf",
  sizeBytes: 2_500_000_000,
  defaultContextTokens: 4096,
  minRecommendedRamBytes: 8_000_000_000,
  vision: false,
} as const;

export type EvidenceStatus = "ПОДТВЕРЖДЕНО" | "ГИПОТЕЗА" | "НЕ ПОДТВЕРЖДЕНО" | "ТРЕБУЕТ ПРОВЕРКИ";

export type LocalEvidence = {
  id: string;
  source: string;
  text: string;
  status: EvidenceStatus;
};

export type LocalInferenceSettings = {
  enabled: boolean;
  modelId: string;
  contextTokens: 2048 | 4096 | 8192;
  backend: "cpu" | "gpu" | "npu" | "auto";
  maxMemoryMb: number;
};

export type LocalInferenceRequest = {
  system: string;
  prompt: string;
  context: LocalInferenceSettings;
};

export type LocalInferenceResponse = {
  text: string;
  promptTokens?: number;
  generatedTokens?: number;
  elapsedMs?: number;
};

export interface LocalInferenceProvider {
  readonly id: string;
  isReady(): Promise<boolean>;
  generate(request: LocalInferenceRequest): Promise<LocalInferenceResponse>;
  unload(): Promise<void>;
}

export type RcaInvestigationState = {
  confirmedFacts: LocalEvidence[];
  hypotheses: LocalEvidence[];
  rejectedHypotheses: LocalEvidence[];
  missingData: string[];
  nextQuestion: string;
};

export const DEFAULT_LOCAL_AI_SETTINGS: LocalInferenceSettings = {
  enabled: true,
  modelId: LOCAL_MODEL.id,
  contextTokens: LOCAL_MODEL.defaultContextTokens,
  backend: "auto",
  maxMemoryMb: 5120,
};

export function buildInvestigatorPrompt(input: {
  caseContext: string;
  state: RcaInvestigationState;
  userMessage: string;
}) {
  return [
    "Ты — локальный AI-следователь RCA по отказам насосного оборудования.",
    "Работай только с переданными материалами. Не выдумывай факты и не называй гипотезу доказанной причиной.",
    "Каждое утверждение помечай одним статусом: ПОДТВЕРЖДЕНО, ГИПОТЕЗА, НЕ ПОДТВЕРЖДЕНО или ТРЕБУЕТ ПРОВЕРКИ.",
    "Сначала отдели факты от предположений. Затем перечисли конкурирующие гипотезы, доказательства за/против, недостающие данные и один наиболее полезный следующий вопрос.",
    "Не завершай расследование, если критических доказательств недостаточно.",
    `КОНТЕКСТ КЕЙСА:\n${input.caseContext}`,
    `ПРЕДЫДУЩЕЕ СОСТОЯНИЕ:\n${JSON.stringify(input.state)}`,
    `НОВОЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n${input.userMessage}`,
    "Верни компактный структурированный ответ на русском языке.",
  ].join("\n\n");
}

export function isLocalModelReady(settings: LocalInferenceSettings, providerReady: boolean) {
  return settings.enabled && settings.modelId === LOCAL_MODEL.id && providerReady;
}
