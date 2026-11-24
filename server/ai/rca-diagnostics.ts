import { randomUUID } from "node:crypto";
import { AiGatewayError, type AiResponse } from "./types";

export type RcaPipelineStage = "photo" | "video" | "document" | "technical" | "analyst" | "critic" | "composer" | "validation" | "save";

const RCA_ERROR_MARKER = "__pumprcaRcaError";

export function createRcaCorrelationId() {
  return randomUUID();
}

export function getRcaErrorEnvelopeMetadata(value: unknown): { stage: RcaPipelineStage; correlationId: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record[RCA_ERROR_MARKER] !== true) return undefined;
  const stages: RcaPipelineStage[] = ["photo", "video", "document", "technical", "analyst", "critic", "composer", "validation", "save"];
  const stage = typeof record.stage === "string" && stages.includes(record.stage as RcaPipelineStage)
    ? record.stage as RcaPipelineStage
    : undefined;
  const correlationId = typeof record.correlationId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(record.correlationId)
    ? record.correlationId
    : undefined;
  return stage && correlationId ? { stage, correlationId } : undefined;
}

export function createRcaErrorEnvelopeCause(stage: RcaPipelineStage, correlationId: string) {
  return { [RCA_ERROR_MARKER]: true, stage, correlationId };
}

function safeError(error: unknown) {
  if (error instanceof AiGatewayError) {
    return { code: error.code, status: error.status, modelId: error.modelId };
  }
  if (error instanceof Error) return { code: "UNEXPECTED_ERROR" };
  return { code: "UNEXPECTED_ERROR" };
}

export function logRcaEvent(input: {
  correlationId: string;
  stage: RcaPipelineStage;
  outcome: "started" | "succeeded" | "failed";
  response?: AiResponse;
  error?: unknown;
}) {
  const record: Record<string, unknown> = {
    event: "pumprca.rca",
    correlationId: input.correlationId,
    stage: input.stage,
    outcome: input.outcome,
  };
  if (input.response) {
    record.provider = input.response.provider;
    record.modelId = input.response.model;
    record.usage = {
      promptTokens: input.response.usage.promptTokens,
      completionTokens: input.response.usage.completionTokens,
      totalTokens: input.response.usage.totalTokens,
      costUsd: input.response.usage.cost,
    };
  }
  if (input.error) Object.assign(record, safeError(input.error));
  const write = input.outcome === "failed" ? console.error : console.info;
  write("[PumpRCA RCA]", JSON.stringify(record));
}

export class RcaPipelineError extends Error {
  constructor(
    public readonly stage: RcaPipelineStage,
    public readonly correlationId: string,
    public readonly cause: unknown,
  ) {
    super(`RCA ${stage} stage failed (correlationId: ${correlationId}).`);
    this.name = "RcaPipelineError";
  }
}
