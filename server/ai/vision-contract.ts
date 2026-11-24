import type { AiMessage } from "./types";

export const PREFERRED_FREE_VISION_MODEL = "nvidia/nemotron-3.5-super-vl:free" as const;

export const FREE_VISION_MODEL_FALLBACKS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "dots-studio/dots-3-note-preview:free",
  "openrouter/free",
] as const;

export const VISION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "pump_vision_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        visibleFacts: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Only directly visible observations from the image.",
        },
        possibleDefects: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Possible visual defects, never confirmed root causes.",
        },
        hypotheses: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Open hypotheses suggested by visible evidence.",
        },
        missingData: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Things that cannot be established from this image alone.",
        },
        recommendedChecks: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Concrete field checks needed to verify the observations.",
        },
        confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Confidence in visual observations only, not in root cause.",
        },
      },
      required: ["visibleFacts", "possibleDefects", "hypotheses", "missingData", "recommendedChecks", "confidence"],
      additionalProperties: false,
    },
  },
} as const;

export const VISION_SYSTEM_PROMPT = `Ты — модуль визуальной инспекции насосного оборудования.

Проанализируй только предоставленное изображение. Не используй имя файла, metadata, текст запроса или предположения о том, что не видно на изображении.

Верни только JSON, строго соответствующий заданной JSON Schema. Не добавляй Markdown, пояснения, \`\`\`json или дополнительные поля.

Правила:
- visibleFacts: только непосредственно видимые признаки. Описывай форму, расположение, цвет, трещины, течи, коррозию, деформации и положение деталей. Не называй причину доказанной.
- possibleDefects: только возможные визуальные дефекты. Если дефект нельзя уверенно определить, оставь массив пустым.
- hypotheses: только открытые гипотезы. Не превращай гипотезу в факт.
- missingData: укажи, что невозможно определить по одному изображению: внутреннее состояние, вибрацию, давление, температуру, ток двигателя и момент возникновения повреждения. Если изображение информативно, всё равно укажи существенные полевые проверки.
- recommendedChecks: конкретные проверяемые действия инженера. Не утверждай, что проверка уже выполнена.
- confidence: целое число 0–100 только для визуального наблюдения, а не для коренной причины.

Никогда не выдавай описание имени файла или metadata за наблюдение.`;

export function withVisionContractMessages(messages: AiMessage[]): AiMessage[] {
  return [
    { role: "system", content: VISION_SYSTEM_PROMPT },
    ...messages.filter((message) => message.role !== "system"),
  ];
}
