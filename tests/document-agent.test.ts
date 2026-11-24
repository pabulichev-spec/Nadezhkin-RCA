import { describe, expect, it } from "vitest";
import { runDocumentAnalysis } from "../server/ai/document-agent";
import { AiGatewayError, type AiRequest, type AiResponse } from "../server/ai/types";

const documentResult = JSON.stringify({
  documentType: "MEASUREMENT_REPORT",
  summary: "Протокол измерения вибрации насоса P-204.",
  facts: [{ statement: "Измерение выполнено 04.11.2026", category: "EVENT", evidenceRef: "vibration.csv" }],
  measurements: [{ parameter: "Виброскорость", value: "8,4", unit: "мм/с", dateOrTime: "04.11.2026 10:30", context: "Точка H", evidenceRef: "vibration.csv" }],
  events: [{ dateOrTime: "04.11.2026 10:30", description: "Зафиксирована виброскорость 8,4 мм/с", evidenceRef: "vibration.csv" }],
  inconsistencies: [],
  missingData: ["Не указана частота вращения"],
  confidence: 96,
});

function response(content: string): AiResponse {
  return { content, model: "nvidia/nemotron-3.5-super-vl:free", provider: "openrouter", usage: { cost: 0 } };
}

function dataUrl(mime: string, text: string) {
  return `data:${mime};base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

describe("Document Agent", () => {
  it("extracts documented facts and preserves exact evidence references", async () => {
    let request: AiRequest | undefined;
    const result = await runDocumentAnalysis([{
      evidenceRef: "vibration.csv",
      mimeType: "text/csv",
      fileData: dataUrl("text/csv", "date,point,value,unit\\n04.11.2026,H,8,4,мм/с"),
    }], async (value) => {
      request = value;
      return response(documentResult);
    });

    expect(request?.task).toBe("DOCUMENT_ANALYSIS");
    expect(request?.agentRole).toBe("vision");
    expect(request?.model).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(request?.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining("vibration.csv") }),
      expect.objectContaining({ type: "text", text: expect.stringContaining("8,4") }),
    ]));
    expect(JSON.parse(result.content).measurements[0]).toMatchObject({ value: "8,4", unit: "мм/с", evidenceRef: "vibration.csv" });
    expect(result.usage.cost).toBe(0);
  });

  it("sends PDF as a file part to the dedicated free vision route", async () => {
    let request: AiRequest | undefined;
    const pdfData = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 test").toString("base64")}`;
    await runDocumentAnalysis([{ evidenceRef: "passport.pdf", mimeType: "application/pdf", fileData: pdfData }], async (value) => {
      request = value;
      return response(documentResult.replaceAll("vibration.csv", "passport.pdf"));
    });
    expect(request?.task).toBe("DOCUMENT_ANALYSIS");
    expect(request?.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "file", file: expect.objectContaining({ filename: "passport.pdf", file_data: pdfData }) }),
    ]));
  });

  it("rejects an invented evidence reference", async () => {
    const invented = documentResult.replaceAll("vibration.csv", "invented-source.pdf");
    await expect(runDocumentAnalysis([{
      evidenceRef: "vibration.csv",
      mimeType: "text/plain",
      fileData: dataUrl("text/plain", "Измерение: 8,4 мм/с"),
    }], async () => response(invented))).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });

  it("rejects unsupported file types and malformed payloads before provider invocation", async () => {
    let called = false;
    const provider = async () => { called = true; return response(documentResult); };
    await expect(runDocumentAnalysis([{ evidenceRef: "sheet.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileData: "data:application/octet-stream;base64,AA==" }], provider)).rejects.toBeInstanceOf(AiGatewayError);
    await expect(runDocumentAnalysis([{ evidenceRef: "bad.pdf", mimeType: "application/pdf", fileData: "https://example.com/file.pdf" }], provider)).rejects.toBeInstanceOf(AiGatewayError);
    expect(called).toBe(false);
  });
});
