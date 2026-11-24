import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type LocalAiResult = { text: string; success: boolean };

export type LocalAiPhase =
  | "IMAGE_DECODE" | "VISION_MODEL_LOAD" | "MMPROJ_LOAD" | "MTMD_TOKENIZE"
  | "MTMD_EVAL" | "VISION_GENERATE" | "VISION_UNLOAD"
  | "QWEN3_LOAD" | "QWEN3_CONTEXT" | "PROMPT_TOKENIZE"
  | "PROMPT_DECODE" | "QWEN3_GENERATE" | "QWEN3_UNLOAD";

type PumpRcaLocalAiModule = {
  runVisionRca(visionModelPath: string, mmprojPath: string, imageBase64: string): Promise<LocalAiResult>;
  runTextRca(qwen3ModelPath: string, prompt: string): Promise<LocalAiResult>;
  runDiagnosticMode?(qwen3ModelPath: string, visionModelPath: string, mmprojPath: string, imageBase64: string): Promise<{ textSuccess: boolean; visionSuccess: boolean; text?: string; vision?: string }>;
  cancelAnalysis(): void;
  getLastDiagnostic?(): Promise<{ kind?: string; last?: string; nativeLog?: string; updatedAt?: number }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const native = Platform.OS === "android" ? (NativeModules.PumpRcaLocalAI as PumpRcaLocalAiModule | undefined) : undefined;

export const PHASE_LABELS: Record<LocalAiPhase, string> = {
  IMAGE_DECODE: "Подготавливаю кадр",
  VISION_MODEL_LOAD: "Загружаю Qwen2.5-VL",
  MMPROJ_LOAD: "Загружаю зрительный энкодер",
  MTMD_TOKENIZE: "Передаю изображение модели",
  MTMD_EVAL: "Анализирую изображение",
  VISION_GENERATE: "Описываю видимые детали",
  VISION_UNLOAD: "Освобождаю память Vision",
  QWEN3_LOAD: "Загружаю Qwen3",
  QWEN3_CONTEXT: "Готовлю контекст RCA",
  PROMPT_TOKENIZE: "Размечаю факты и свидетельства",
  PROMPT_DECODE: "Обрабатываю факты",
  QWEN3_GENERATE: "Формирую 4 блока RCA",
  QWEN3_UNLOAD: "Освобождаю память Qwen3",
};

export function isLocalAiNativeAvailable() {
  return Boolean(native);
}

export function isLocalAiAvailable() {
  return Boolean(native) || (Platform.OS === "web" && typeof window !== "undefined" && "gpu" in navigator);
}

export function getLocalAiDescription() {
  return Platform.OS === "web" ? "Browser AI · WebGPU · локальная vision-модель + Qwen2.5-0.5B RCA · без API и оплаты" : "Qwen3/Qwen2.5-VL · локально на Android";
}

export function subscribeLocalAiProgress(onPhase: (phase: LocalAiPhase) => void): () => void {
  if (!native) return () => undefined;
  const subscription = new NativeEventEmitter(native).addListener("PumpRcaAIProgress", (data: { phase?: string }) => {
    const phase = data.phase as LocalAiPhase;
    if (phase && Object.prototype.hasOwnProperty.call(PHASE_LABELS, phase)) onPhase(phase);
  });
  return () => subscription.remove();
}

export function cancelLocalAiAnalysis() {
  native?.cancelAnalysis();
}

export async function getLastLocalAiDiagnostic() {
  return native?.getLastDiagnostic ? native.getLastDiagnostic() : undefined;
}

export async function runLocalDiagnosticMode(qwen3ModelPath: string, visionModelPath: string, mmprojPath: string, imageBase64: string) {
  if (!native?.runDiagnosticMode) throw new Error("LOCAL_AI_DIAGNOSTIC_UNAVAILABLE");
  return native.runDiagnosticMode(qwen3ModelPath, visionModelPath, mmprojPath, imageBase64);
}

export async function runLocalTextRca(qwen3ModelPath: string, prompt: string) {
  if (!native && Platform.OS === "web") return (await import("@/lib/browser-local-ai")).runBrowserText(prompt);
  if (!native) throw new Error("LOCAL_AI_NATIVE_UNAVAILABLE");
  return native.runTextRca(qwen3ModelPath, prompt);
}

export async function runLocalVisionRca(visionModelPath: string, mmprojPath: string, imageBase64: string) {
  if (!native && Platform.OS === "web") return (await import("@/lib/browser-local-ai")).runBrowserVision(`data:image/jpeg;base64,${imageBase64}`);
  if (!native) throw new Error("LOCAL_AI_NATIVE_UNAVAILABLE");
  return native.runVisionRca(visionModelPath, mmprojPath, imageBase64);
}
