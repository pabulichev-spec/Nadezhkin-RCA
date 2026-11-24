import { describe, expect, it } from "vitest";
import { isVisionRequest } from "../server/ai/provider-router";
import type { AiRequest } from "../server/ai/types";

describe("free provider modality routing", () => {
  it("keeps document analysis off the text-only OmniRoute adapter", () => {
    const request: AiRequest = {
      task: "DOCUMENT_ANALYSIS",
      agentRole: "vision",
      messages: [{ role: "user", content: "Analyze attached maintenance document." }],
    };
    expect(isVisionRequest(request)).toBe(true);
  });

  it("recognizes file content parts as multimodal even if the task is generic", () => {
    const request: AiRequest = {
      task: "CHAT",
      messages: [{ role: "user", content: [{ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } }] }],
    };
    expect(isVisionRequest(request)).toBe(true);
  });
});
