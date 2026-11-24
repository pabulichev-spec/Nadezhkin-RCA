import { describe, expect, it } from "vitest";
import { isSupportedAiDocumentMime } from "../shared/ai-media";

describe("AI document input policy", () => {
  it("accepts PDF and text documents", () => {
    expect(isSupportedAiDocumentMime("application/pdf")).toBe(true);
    expect(isSupportedAiDocumentMime("text/plain")).toBe(true);
    expect(isSupportedAiDocumentMime("application/json")).toBe(true);
    expect(isSupportedAiDocumentMime("text/csv")).toBe(true);
    expect(isSupportedAiDocumentMime("text/markdown")).toBe(true);
  });

  it("rejects unsupported binary files before an AI request", () => {
    expect(isSupportedAiDocumentMime("application/vnd.ms-excel")).toBe(false);
    expect(isSupportedAiDocumentMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(isSupportedAiDocumentMime("text/html")).toBe(false);
    expect(isSupportedAiDocumentMime("application/zip")).toBe(false);
    expect(isSupportedAiDocumentMime(undefined)).toBe(false);
  });
});
