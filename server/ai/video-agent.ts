import { parseJsonPayload } from "./rca-validator";
import { allowlistedModelIds } from "./free-allowlist";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";
import { callFreeProvider } from "./provider-router";

export type VideoFrameInput = {
  evidenceRef: string;
  timestampMs: number;
  imageData: string;
  note?: string;
};

export type VideoAnalysisResult = {
  sequenceEvents: Array<{ timestampMs: number; observation: string; significance: string }>;
  visibleFacts: string[];
  possibleDefects: string[];
  hypotheses: string[];
  missingData: string[];
  recommendedChecks: string[];
  confidence: number;
};

export const VIDEO_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "pump_video_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sequenceEvents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestampMs: { type: "integer", minimum: 0 },
              observation: { type: "string", minLength: 1 },
              significance: { type: "string" },
            },
            required: ["timestampMs", "observation", "significance"],
            additionalProperties: false,
          },
        },
        visibleFacts: { type: "array", items: { type: "string", minLength: 1 } },
        possibleDefects: { type: "array", items: { type: "string", minLength: 1 } },
        hypotheses: { type: "array", items: { type: "string", minLength: 1 } },
        missingData: { type: "array", items: { type: "string", minLength: 1 } },
        recommendedChecks: { type: "array", items: { type: "string", minLength: 1 } },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["sequenceEvents", "visibleFacts", "possibleDefects", "hypotheses", "missingData", "recommendedChecks", "confidence"],
      additionalProperties: false,
    },
  },
} as const;

const VIDEO_SYSTEM_PROMPT = `Ты — Video Agent системы RCA для промышленного насосного оборудования.
Проанализируй последовательность извлечённых кадров одного видео в хронологическом порядке.
Кадры — это отдельные изображения с указанными временными метками; не утверждай, что видел непрерывное движение или звук.
Верни только JSON по заданной схеме.
Правила:
- sequenceEvents: наблюдения по временным меткам; timestampMs каждого события должен точно совпадать с одним из временных значений входных кадров; не придумывай промежуточные события.
- visibleFacts: только непосредственно видимые признаки.
- possibleDefects: возможные визуальные дефекты, не подтверждённые причины.
- hypotheses: осторожные проверяемые гипотезы, не выдавай их за факты.
- missingData: укажи то, что нельзя установить по кадрам, включая звук, вибрацию, давление, температуру и внутреннее состояние.
- recommendedChecks: конкретные проверки инженера.
- confidence относится только к визуальным наблюдениям.
Не используй имя файла или заметки как визуальное доказательство.`;

function normalizeVideoResult(content: string, frames: VideoFrameInput[]): VideoAnalysisResult {
  let parsed: unknown;
  try {
    parsed = parseJsonPayload(content);
  } catch {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "Video Agent returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new AiGatewayError("INVALID_AI_RESPONSE", "Video Agent returned an invalid result.");
  const value = parsed as Record<string, unknown>;
  const stringArray = (field: string) => Array.isArray(value[field]) && (value[field] as unknown[]).every((item) => typeof item === "string")
    ? value[field] as string[]
    : undefined;
  const sequenceEvents = Array.isArray(value.sequenceEvents) ? value.sequenceEvents : undefined;
  const validTimestamps = new Set(frames.map((frame) => frame.timestampMs));
  const confidence = value.confidence;
  if (!sequenceEvents || !sequenceEvents.every((event) => !!event && typeof event === "object"
    && Number.isInteger((event as Record<string, unknown>).timestampMs)
    && validTimestamps.has((event as Record<string, unknown>).timestampMs as number)
    && typeof (event as Record<string, unknown>).observation === "string"
    && Boolean(((event as Record<string, unknown>).observation as string).trim())
    && typeof (event as Record<string, unknown>).significance === "string")
    || !stringArray("visibleFacts") || !stringArray("possibleDefects") || !stringArray("hypotheses")
    || !stringArray("missingData") || !stringArray("recommendedChecks")
    || !Number.isInteger(confidence) || (confidence as number) < 0 || (confidence as number) > 100) {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "Video Agent returned an incompatible structured result.");
  }
  return {
    sequenceEvents: sequenceEvents as VideoAnalysisResult["sequenceEvents"],
    visibleFacts: stringArray("visibleFacts")!,
    possibleDefects: stringArray("possibleDefects")!,
    hypotheses: stringArray("hypotheses")!,
    missingData: stringArray("missingData")!,
    recommendedChecks: stringArray("recommendedChecks")!,
    confidence: confidence as number,
  };
}

export async function runVideoAnalysis(
  frames: VideoFrameInput[],
  provider: (request: AiRequest) => Promise<AiResponse> = callFreeProvider,
): Promise<AiResponse> {
  if (!frames.length || frames.length > 8) {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "Video analysis requires between 1 and 8 extracted frames.");
  }
  for (const frame of frames) {
    if (!Number.isInteger(frame.timestampMs) || frame.timestampMs < 0 || frame.imageData.length > 7_000_000 || !/^data:image\/(jpeg|png|webp);base64,/i.test(frame.imageData)) {
      throw new AiGatewayError("INVALID_AI_RESPONSE", "Video frame payload is invalid.");
    }
  }
  if (frames.reduce((total, frame) => total + frame.imageData.length, 0) > 24_000_000) {
    throw new AiGatewayError("INVALID_AI_RESPONSE", "Video frames exceed the 24 MB analysis limit.");
  }
  const content: Exclude<AiRequest["messages"][number]["content"], string> = [
    { type: "text", text: `Проанализируй ${frames.length} кадров видео. Временные метки указаны в миллисекундах. Сгруппируй только реально наблюдаемые события по времени.` },
  ];
  for (const frame of [...frames].sort((a, b) => a.timestampMs - b.timestampMs)) {
    content.push({ type: "text", text: `Кадр ${frame.timestampMs} мс${frame.note ? `. Примечание: ${frame.note}` : ""}` });
    // Low detail is intentional: the client already downsizes frames and the
    // mobile path must remain reliable on long videos and constrained networks.
    content.push({ type: "image_url", image_url: { url: frame.imageData, detail: "low" } });
  }
  const response = await provider({
    task: "VIDEO_ANALYSIS",
    agentRole: "vision",
    model: allowlistedModelIds("vision")[0],
    messages: [
      { role: "system", content: VIDEO_SYSTEM_PROMPT },
      { role: "user", content },
    ],
    responseFormat: VIDEO_RESPONSE_FORMAT,
    reasoning: { enabled: false },
    maxTokens: 1800,
  });
  const normalized = normalizeVideoResult(response.content, frames);
  return { ...response, content: JSON.stringify(normalized) };
}
