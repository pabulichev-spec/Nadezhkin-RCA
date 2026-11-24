import { describe, expect, it } from "vitest";
import { runVideoAnalysis } from "../server/ai/video-agent";
import { AiGatewayError, type AiRequest, type AiResponse } from "../server/ai/types";

const videoResult = JSON.stringify({
  sequenceEvents: [{ timestampMs: 1000, observation: "На корпусе видна капля жидкости", significance: "Возможный признак утечки; источник не установлен" }],
  visibleFacts: ["На наружной поверхности корпуса видна капля жидкости"],
  possibleDefects: ["Возможна наружная утечка"],
  hypotheses: ["Возможна негерметичность соединения; требуется осмотр"],
  missingData: ["Нет данных о давлении и расходе"],
  recommendedChecks: ["Осмотреть соединение после безопасной остановки"],
  confidence: 72,
});

function response(content: string): AiResponse {
  return { content, model: "nvidia/nemotron-3.5-super-vl:free", provider: "openrouter", usage: { cost: 0 } };
}

const frame = { evidenceRef: "pump-video.mp4", timestampMs: 1000, imageData: "data:image/jpeg;base64,ZmFrZQ==", note: "Кадр 1 с" };

describe("Video Agent", () => {
  it("sends timestamped extracted frames to the vision free route and normalizes its result", async () => {
    let request: AiRequest | undefined;
    const result = await runVideoAnalysis([frame], async (value) => {
      request = value;
      return response(videoResult);
    });
    expect(request?.task).toBe("VIDEO_ANALYSIS");
    expect(request?.agentRole).toBe("vision");
    expect(request?.model).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(request?.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining("1000 мс") }),
      expect.objectContaining({ type: "image_url" }),
    ]));
    expect(JSON.parse(result.content).sequenceEvents[0].timestampMs).toBe(1000);
    expect(result.usage.cost).toBe(0);
  });

  it("rejects invalid frame payloads before making a provider call", async () => {
    let called = false;
    await expect(runVideoAnalysis([{ ...frame, imageData: "https://example.com/video.mp4" }], async () => {
      called = true;
      return response(videoResult);
    })).rejects.toBeInstanceOf(AiGatewayError);
    expect(called).toBe(false);
  });

  it("rejects incompatible model output", async () => {
    await expect(runVideoAnalysis([frame], async () => response("not-json"))).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });
});
