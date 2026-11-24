import { parseJsonPayload, normalizeAndValidateVision } from "./rca-validator";
import { allowlistedModelIds } from "./free-allowlist";
import { AiGatewayError, type AiRequest, type AiResponse } from "./types";
import { callFreeProvider } from "./provider-router";
import { VISION_RESPONSE_FORMAT } from "./vision-contract";

export type PhotoInput = { evidenceRef: string; imageData: string; note?: string };
export type PhotoFinding = { evidenceRef: string; visibleFacts: string[]; possibleDefects: string[]; hypotheses: string[]; missingData: string[]; recommendedChecks: string[]; confidence: number };
export type PhotoAnalysisResult = { images: PhotoFinding[] };

const PHOTO_SYSTEM_PROMPT = `Ты — Photo Agent системы RCA для промышленного насосного оборудования. Анализируй только непосредственно видимые признаки на переданном изображении. Игнорируй имя файла и примечание как визуальное доказательство. Не определяй скрытое внутреннее состояние и не выдавай визуальную гипотезу за установленную причину. Верни только JSON по заданной схеме. Укажи видимые детали, возможные дефекты, осторожные гипотезы, недостающие данные и конкретные проверки инженера. Не утверждай, что измерения или проверки уже выполнены.`;

function validatePhotoInput(photos: PhotoInput[]) {
  if (!photos.length || photos.length > 10) throw new AiGatewayError("INVALID_AI_RESPONSE", "Photo analysis requires between 1 and 10 images.");
  let total = 0;
  for (const photo of photos) {
    if (typeof photo.evidenceRef !== "string" || !photo.evidenceRef.trim() || typeof photo.imageData !== "string" || !/^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageData) || photo.imageData.length > 7_000_000) {
      throw new AiGatewayError("INVALID_AI_RESPONSE", "Photo evidence payload is invalid.");
    }
    total += photo.imageData.length;
  }
  if (total > 24_000_000) throw new AiGatewayError("INVALID_AI_RESPONSE", "Photo evidence exceeds the 24 MB analysis limit.");
}

export async function runPhotoAnalysis(
  photos: PhotoInput[],
  provider: (request: AiRequest) => Promise<AiResponse> = callFreeProvider,
): Promise<AiResponse> {
  validatePhotoInput(photos);
  const images: PhotoFinding[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let providerName: AiResponse["provider"] = "openrouter";
  let modelName = allowlistedModelIds("vision")[0];

  // Analyze separately so every observation is bound to one exact evidence reference.
  for (const photo of photos) {
    const response = await provider({
      task: "PHOTO_ANALYSIS",
      agentRole: "vision",
      model: allowlistedModelIds("vision")[0],
      messages: [
        { role: "system", content: PHOTO_SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: "Проведи визуальную инспекцию этого изображения. Не используй примечание как доказательство: " + (photo.note ? "Примечание (только контекст): " + photo.note : "примечание отсутствует") },
          { type: "image_url", image_url: { url: photo.imageData, detail: "auto" } },
        ] },
      ],
      responseFormat: VISION_RESPONSE_FORMAT,
      reasoning: { enabled: false },
      maxTokens: 1400,
    });
    let payload: unknown;
    try { payload = parseJsonPayload(response.content); } catch { throw new AiGatewayError("INVALID_AI_RESPONSE", "Photo Agent returned invalid JSON."); }
    const normalized = normalizeAndValidateVision(payload);
    images.push({ evidenceRef: photo.evidenceRef, ...normalized });
    promptTokens += response.usage.promptTokens ?? 0;
    completionTokens += response.usage.completionTokens ?? 0;
    providerName = response.provider;
    modelName = response.model;
  }

  const result: PhotoAnalysisResult = { images };
  return { content: JSON.stringify(result), model: modelName, provider: providerName, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cost: 0 } };
}
