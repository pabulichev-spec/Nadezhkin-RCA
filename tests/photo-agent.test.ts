import { describe, expect, it } from "vitest";
import { runPhotoAnalysis } from "../server/ai/photo-agent";
import { AiGatewayError, type AiRequest, type AiResponse } from "../server/ai/types";

const validResult = JSON.stringify({
  visibleFacts: ["След жидкости на корпусе"],
  possibleDefects: ["Возможная наружная утечка"],
  hypotheses: ["Возможна негерметичность соединения"],
  missingData: ["Нет данных о давлении"],
  recommendedChecks: ["Осмотреть соединение после безопасной остановки"],
  confidence: 75,
});

function response(content: string): AiResponse {
  return { content, model: "nvidia/nemotron-3.5-super-vl:free", provider: "openrouter", usage: { cost: 0 } };
}

const photo = { evidenceRef: "seal.jpg", imageData: "data:image/jpeg;base64,ZmFrZQ==" };

describe("Photo Agent", () => {
  it("uses the vision free route and preserves exact evidence references", async () => {
    let request: AiRequest | undefined;
    const result = await runPhotoAnalysis([photo], async (value) => { request = value; return response(validResult); });
    expect(request?.task).toBe("PHOTO_ANALYSIS");
    expect(request?.agentRole).toBe("vision");
    expect(request?.model).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(request?.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))).toBe(true);
    expect(JSON.parse(result.content).images[0].evidenceRef).toBe("seal.jpg");
    expect(result.usage.cost).toBe(0);
  });

  it("rejects unsupported image payloads before provider invocation", async () => {
    let called = false;
    await expect(runPhotoAnalysis([{ ...photo, imageData: "https://example.com/photo.jpg" }], async () => { called = true; return response(validResult); })).rejects.toBeInstanceOf(AiGatewayError);
    expect(called).toBe(false);
  });

  it("rejects more than ten photos and incompatible model output", async () => {
    await expect(runPhotoAnalysis(Array.from({ length: 11 }, (_, index) => ({ ...photo, evidenceRef: `${index}.jpg` })), async () => response(validResult))).rejects.toBeInstanceOf(AiGatewayError);
    await expect(runPhotoAnalysis([photo], async () => response("not-json"))).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });
});
