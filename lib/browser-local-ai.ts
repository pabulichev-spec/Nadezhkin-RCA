type TransformersApi = {
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends: { onnx?: { wasm?: { numThreads: number } } };
  };
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __pumprcaTransformers: TransformersApi | undefined;
  var __pumprcaTransformersError: string | undefined;
}

export type BrowserLocalAiResult = { text: string; success: boolean };
export type BrowserLocalAiPhase =
  | "BROWSER_CAPABILITY"
  | "BROWSER_VISION_LOAD"
  | "BROWSER_VISION_GENERATE"
  | "BROWSER_TEXT_LOAD"
  | "BROWSER_TEXT_GENERATE";

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";
const TEXT_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct-ONNX-MHA";
const VISION_MODEL = "Xenova/vit-gpt2-image-captioning";
type BrowserDevice = "webgpu" | "wasm";
let selectedDevice: BrowserDevice = "webgpu";

type TextPipeline = (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;
type VisionPipeline = (image: string, options?: Record<string, unknown>) => Promise<unknown>;

let textPipeline: TextPipeline | null = null;
let visionPipeline: VisionPipeline | null = null;
let textLoading: Promise<TextPipeline> | null = null;
let visionLoading: Promise<VisionPipeline> | null = null;
let transformersLoading: Promise<TransformersApi> | null = null;
const listeners = new Set<(phase: BrowserLocalAiPhase) => void>();

function emit(phase: BrowserLocalAiPhase) { listeners.forEach((listener) => listener(phase)); }

function saveBrowserDiagnostic(kind: string, details: string) {
  const payload = `kind=${kind}\ntime=${new Date().toISOString()}\nruntime=Transformers.js\n${details}`;
  try { window.localStorage.setItem("pumprca.browser-ai.diagnostic", payload.slice(-100_000)); } catch { /* storage is optional */ }
  console.warn("[PumpRCA Browser AI]", payload);
}

async function loadTransformers(): Promise<TransformersApi> {
  if (globalThis.__pumprcaTransformers) return globalThis.__pumprcaTransformers;
  if (!transformersLoading) {
    transformersLoading = new Promise<TransformersApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-pumprca-transformers]");
      if (!existing) {
        const script = document.createElement("script");
        script.type = "module";
        script.dataset.pumprcaTransformers = "true";
        script.textContent = `import(${JSON.stringify(TRANSFORMERS_CDN)}).then(api => window.__pumprcaTransformers = api).catch(error => { window.__pumprcaTransformersError = String(error?.message || error); });`;
        script.onerror = () => reject(new Error("BROWSER_AI_RUNTIME_LOAD_FAILED: не удалось загрузить Transformers.js. Проверьте интернет для первой загрузки модели."));
        document.head.appendChild(script);
      }
      const startedAt = Date.now();
      const wait = window.setInterval(() => {
        if (globalThis.__pumprcaTransformers) {
          window.clearInterval(wait);
          resolve(globalThis.__pumprcaTransformers);
        } else if (globalThis.__pumprcaTransformersError) {
          window.clearInterval(wait);
          reject(new Error(`BROWSER_AI_RUNTIME_LOAD_FAILED: ${globalThis.__pumprcaTransformersError}`));
        } else if (Date.now() - startedAt > 30_000) {
          window.clearInterval(wait);
          reject(new Error("BROWSER_AI_RUNTIME_TIMEOUT: не удалось инициализировать Browser AI runtime."));
        }
      }, 50);
    }).catch((error) => { transformersLoading = null; throw error; });
  }
  return transformersLoading;
}

async function getApi() {
  if (typeof window === "undefined") throw new Error("BROWSER_LOCAL_AI_REQUIRES_BROWSER");
  const api = await loadTransformers();
  api.env.allowRemoteModels = true;
  api.env.allowLocalModels = false;
  api.env.useBrowserCache = true;
  if (api.env.backends.onnx?.wasm) api.env.backends.onnx.wasm.numThreads = 1;
  emit("BROWSER_CAPABILITY");
  return api;
}

async function loadPipelineWithFallback<T>(api: TransformersApi, task: string, model: string): Promise<T> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  let canUseWebGpu = Boolean(gpu?.requestAdapter);
  if (canUseWebGpu) {
    try {
      canUseWebGpu = Boolean(await gpu?.requestAdapter?.());
      if (!canUseWebGpu) saveBrowserDiagnostic("WEBGPU_UNAVAILABLE", "navigator.gpu exists but requestAdapter returned null");
    } catch (error) {
      canUseWebGpu = false;
      saveBrowserDiagnostic("WEBGPU_ADAPTER_FAILED", error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
    }
  }
  if (canUseWebGpu) {
    try {
      selectedDevice = "webgpu";
      return await api.pipeline(task, model, { device: "webgpu", dtype: "q4" }) as T;
    } catch (webgpuError) {
      saveBrowserDiagnostic("WEBGPU_PIPELINE_FAILED", `${model}\n${webgpuError instanceof Error ? `${webgpuError.message}\n${webgpuError.stack ?? ""}` : String(webgpuError)}`);
      selectedDevice = "wasm";
      try {
        return await api.pipeline(task, model, { device: "wasm" }) as T;
      } catch (wasmError) {
        saveBrowserDiagnostic("WASM_PIPELINE_FAILED", `${model}\n${wasmError instanceof Error ? `${wasmError.message}\n${wasmError.stack ?? ""}` : String(wasmError)}`);
        throw new Error(`BROWSER_MODEL_LOAD_FAILED: ${model}. WebGPU: ${webgpuError instanceof Error ? webgpuError.message : String(webgpuError)}. WASM: ${wasmError instanceof Error ? wasmError.message : String(wasmError)}`);
      }
    }
  }
  selectedDevice = "wasm";
  try {
    return await api.pipeline(task, model, { device: "wasm" }) as T;
  } catch (error) {
    saveBrowserDiagnostic("WASM_PIPELINE_FAILED", `${model}\n${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`);
    throw new Error(`BROWSER_MODEL_LOAD_FAILED: ${model}. Локальный WASM inference не запустился: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function subscribeBrowserLocalAi(listener: (phase: BrowserLocalAiPhase) => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function isBrowserLocalAiAvailable() { return typeof window !== "undefined"; }
export function getBrowserLocalAiDescription() { return `Browser AI · ${selectedDevice === "webgpu" ? "WebGPU" : "WASM CPU fallback"} · локальная vision-модель + Qwen2.5-0.5B RCA · без API и оплаты`; }

async function getVisionPipeline(): Promise<VisionPipeline> {
  const api = await getApi();
  if (visionPipeline) return visionPipeline;
  if (!visionLoading) {
    emit("BROWSER_VISION_LOAD");
    visionLoading = loadPipelineWithFallback<VisionPipeline>(api, "image-to-text", VISION_MODEL).then((loaded) => { visionPipeline = loaded; return loaded; }).catch((error) => { visionLoading = null; throw error; });
  }
  return visionLoading;
}

async function getTextPipeline(): Promise<TextPipeline> {
  const api = await getApi();
  if (textPipeline) return textPipeline;
  if (!textLoading) {
    emit("BROWSER_TEXT_LOAD");
    textLoading = loadPipelineWithFallback<TextPipeline>(api, "text-generation", TEXT_MODEL).then((loaded) => { textPipeline = loaded; return loaded; }).catch((error) => { textLoading = null; throw error; });
  }
  return textLoading;
}

export async function runBrowserVision(imageDataUrl: string): Promise<BrowserLocalAiResult> {
  const model = await getVisionPipeline();
  emit("BROWSER_VISION_GENERATE");
  const output = await model(imageDataUrl, { max_new_tokens: 160 });
  const first = Array.isArray(output) ? output[0] : output;
  const text = typeof first === "object" && first !== null && "generated_text" in first ? String((first as { generated_text?: unknown }).generated_text ?? "") : String(first ?? "");
  if (!text.trim()) throw new Error("BROWSER_VISION_EMPTY: браузерная vision-модель не вернула описание изображения.");
  return { success: true, text: text.trim() };
}

export async function runBrowserText(prompt: string): Promise<BrowserLocalAiResult> {
  const model = await getTextPipeline();
  emit("BROWSER_TEXT_GENERATE");
  const output = await model(prompt, { max_new_tokens: 640, do_sample: false, return_full_text: false });
  const first = Array.isArray(output) ? output[0] : output;
  const text = typeof first === "object" && first !== null && "generated_text" in first ? String((first as { generated_text?: unknown }).generated_text ?? "") : String(first ?? "");
  if (!text.trim()) throw new Error("BROWSER_TEXT_EMPTY: локальная RCA-модель не вернула ответ.");
  return { success: true, text: text.trim() };
}
