import { AiGatewayError } from "./types";
import type { StructuredRca } from "../../shared/rca";

export type ValidatedRcaResult = {
  executiveSummary: string;
  physicalCause: string;
  humanFactor: string;
  systemicCause: string;
  smartActions: Array<{
    priority: string;
    specific: string;
    measurable: string;
    achievable: string;
    relevant: string;
    timeBound: string;
  }>;
  confidence: number;
  openQuestions: string[];
  methodNotes: string;
  structuredRca: StructuredRca;
};

const REQUIRED_TEXT_FIELDS = ["executiveSummary", "physicalCause", "humanFactor", "systemicCause", "methodNotes"] as const;
const SMART_FIELDS = ["priority", "specific", "measurable", "achievable", "relevant", "timeBound"] as const;

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Extract a JSON value when a provider adds reasoning text or a code fence. */
export function parseJsonPayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const direct = parseJsonString(cleaned);
  if (direct !== cleaned) return direct;

  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== "{" && cleaned[start] !== "[") continue;
    const opening = cleaned[start];
    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < cleaned.length; end += 1) {
      const character = cleaned[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === opening) depth += 1;
      else if (character === closing) depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          break;
        }
      }
    }
  }
  return value;
}

function stringifyStructured(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => stringifyStructured(item)).filter(Boolean).join("; ").trim();
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${stringifyStructured(item)}`)
      .filter((line) => !line.endsWith(":"))
      .join(" | ")
      .trim();
  }
  return "";
}

function normalizeTextField(value: unknown) {
  return stringifyStructured(parseJsonString(value));
}

function normalizeFactSource(value: unknown): StructuredRca["facts"][number]["source"] {
  const normalized = normalizeTextField(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, StructuredRca["facts"][number]["source"]> = {
    USER: "USER_PROVIDED",
    USER_PROVIDED: "USER_PROVIDED",
    MEASUREMENT: "MEASURED",
    MEASURED: "MEASURED",
    PHOTO: "MEDIA_OBSERVED",
    VIDEO: "MEDIA_OBSERVED",
    MEDIA: "MEDIA_OBSERVED",
    MEDIA_OBSERVED: "MEDIA_OBSERVED",
    DOCUMENT: "DOCUMENTED",
    DOCUMENTED: "DOCUMENTED",
    UNKNOWN: "UNKNOWN",
  };
  return aliases[normalized] ?? normalized as StructuredRca["facts"][number]["source"];
}

function normalizeHypothesisStatus(value: unknown): StructuredRca["hypotheses"][number]["status"] {
  const normalized = normalizeTextField(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, StructuredRca["hypotheses"][number]["status"]> = {
    OPEN: "OPEN", NEW: "OPEN", НА_ПРОВЕРКЕ: "OPEN",
    SUPPORTED: "SUPPORTED", ПОДТВЕРЖДЕНА: "SUPPORTED",
    CONFIRMED: "CONFIRMED", ПОДТВЕРЖДЕНО: "CONFIRMED",
    REJECTED: "REJECTED", ОТКЛОНЕНА: "REJECTED",
    INSUFFICIENT_DATA: "INSUFFICIENT_DATA", НЕДОСТАТОЧНО_ДАННЫХ: "INSUFFICIENT_DATA",
  };
  return aliases[normalized] ?? normalized as StructuredRca["hypotheses"][number]["status"];
}

function assertMeaningful(value: string, path: string) {
  const lower = value.toLowerCase();
  if (value === "..." || value.length < 3 || lower.includes("not required by schema") || lower.includes("let's output") || lower.includes("ensure json") || lower.includes("assume schema")) {
    fail(`${path} contains placeholder or model meta-text`);
  }
}

function fail(message: string): never {
  throw new AiGatewayError("INVALID_AI_RESPONSE", `RCA validation failed: ${message}`);
}

function normalizeStructuredRca(input: unknown): StructuredRca {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("structuredRca must be an object");
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.facts) || !Array.isArray(raw.symptoms) || !Array.isArray(raw.hypotheses) || !Array.isArray(raw.missingData)) fail("structuredRca requires facts, symptoms, hypotheses and missingData arrays");
  const facts = raw.facts.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`structuredRca.facts[${index}] must be an object`);
    const fact = item as Record<string, unknown>;
    const statement = normalizeTextField(fact.statement);
    const source = normalizeFactSource(fact.source);
    const evidenceRefs = fact.evidenceRefs;
    if (!statement) fail(`structuredRca.facts[${index}].statement is missing`);
    assertMeaningful(statement, `structuredRca.facts[${index}].statement`);
    if (!["USER_PROVIDED", "MEASURED", "MEDIA_OBSERVED", "DOCUMENTED", "UNKNOWN"].includes(source)) fail(`structuredRca.facts[${index}].source is invalid`);
    if (!Array.isArray(evidenceRefs) || evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim())) fail(`structuredRca.facts[${index}].evidenceRefs must be non-empty strings`);
    return { statement, source, evidenceRefs: evidenceRefs.map((ref) => ref.trim()) };
  });
  const symptoms = raw.symptoms.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`structuredRca.symptoms[${index}] must be an object`);
    const symptom = item as Record<string, unknown>;
    const statement = normalizeTextField(symptom.statement);
    const evidenceRefs = symptom.evidenceRefs;
    if (!statement) fail(`structuredRca.symptoms[${index}].statement is missing`);
    assertMeaningful(statement, `structuredRca.symptoms[${index}].statement`);
    if (!Array.isArray(evidenceRefs) || evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim())) fail(`structuredRca.symptoms[${index}].evidenceRefs must be non-empty strings`);
    return { statement, evidenceRefs: evidenceRefs.map((ref) => ref.trim()) };
  });
  const hypotheses = raw.hypotheses.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`structuredRca.hypotheses[${index}] must be an object`);
    const hypothesis = item as Record<string, unknown>;
    const statement = normalizeTextField(hypothesis.statement);
    const supportingFactIndexes = hypothesis.supportingFactIndexes;
    const confidence = hypothesis.confidence;
    const status = normalizeHypothesisStatus(hypothesis.status);
    if (!statement) fail(`structuredRca.hypotheses[${index}].statement is missing`);
    assertMeaningful(statement, `structuredRca.hypotheses[${index}].statement`);
    if (!Array.isArray(supportingFactIndexes) || supportingFactIndexes.length === 0 || supportingFactIndexes.some((ref) => !Number.isInteger(ref) || ref < 0 || ref >= facts.length)) fail(`structuredRca.hypotheses[${index}].supportingFactIndexes must reference existing facts`);
    if (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 0 || confidence > 100) fail(`structuredRca.hypotheses[${index}].confidence must be an integer from 0 to 100`);
    if (!["OPEN", "SUPPORTED", "CONFIRMED", "REJECTED", "INSUFFICIENT_DATA"].includes(status)) fail(`structuredRca.hypotheses[${index}].status is invalid`);
    return { statement, supportingFactIndexes: supportingFactIndexes as number[], confidence, status };
  });
  if (raw.missingData.some((item) => typeof item !== "string" || !item.trim())) fail("structuredRca.missingData must contain non-empty strings");
  return { facts, symptoms, hypotheses, missingData: raw.missingData.map((item) => (item as string).trim()) };
}

export function normalizeAndValidateRca(input: unknown, options?: { knownEvidenceRefs?: string[] }): ValidatedRcaResult {
  const value = parseJsonPayload(input);
  if (typeof input === "string" && typeof value === "string") fail("response is not valid JSON");
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("root must be an object");
  const raw = value as Record<string, unknown>;

  const normalized = {
    executiveSummary: normalizeTextField(raw.executiveSummary),
    physicalCause: normalizeTextField(raw.physicalCause),
    humanFactor: normalizeTextField(raw.humanFactor),
    systemicCause: normalizeTextField(raw.systemicCause),
    methodNotes: normalizeTextField(raw.methodNotes),
  };
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!normalized[field]) fail(`${field} is missing or empty`);
    assertMeaningful(normalized[field], field);
  }

  if (!Array.isArray(raw.smartActions) || raw.smartActions.length === 0) fail("smartActions must be a non-empty array");
  const smartActions = raw.smartActions.map((rawAction, index) => {
    const actionValue = parseJsonString(rawAction);
    if (!actionValue || typeof actionValue !== "object" || Array.isArray(actionValue)) fail(`smartActions[${index}] must be an object`);
    const action = actionValue as Record<string, unknown>;
    const normalizedAction = Object.fromEntries(SMART_FIELDS.map((field) => {
      const safeAliases: Record<string, string[]> = {
        specific: ["action"],
        measurable: ["metrics"],
        timeBound: ["dueDate"],
      };
      const source = action[field] ?? safeAliases[field]?.map((alias) => action[alias]).find((item) => item !== undefined);
      return [field, normalizeTextField(source)];
    })) as Record<string, string>;
    for (const field of SMART_FIELDS) {
      if (!normalizedAction[field]) fail(`smartActions[${index}].${field} is missing or empty`);
      assertMeaningful(normalizedAction[field], `smartActions[${index}].${field}`);
    }
    return normalizedAction as ValidatedRcaResult["smartActions"][number];
  });

  if (typeof raw.confidence !== "number" || !Number.isInteger(raw.confidence) || raw.confidence < 0 || raw.confidence > 100) {
    fail("confidence must be an integer from 0 to 100");
  }
  if (!Array.isArray(raw.openQuestions) || raw.openQuestions.some((item) => typeof item !== "string" || !item.trim())) {
    fail("openQuestions must be an array of non-empty strings");
  }
  if (raw.confidence < 50 && raw.openQuestions.length === 0) fail("low confidence RCA must include openQuestions");

  const structuredRca = normalizeStructuredRca(raw.structuredRca);
  if (raw.confidence < 50 && structuredRca.missingData.length === 0) fail("low confidence RCA must include structuredRca.missingData");
  if (options?.knownEvidenceRefs) {
    const knownRefs = new Set(options.knownEvidenceRefs.map((ref) => ref.trim().toLowerCase()).filter(Boolean).concat(["narrative", "case narrative"]));
    const refs = [...structuredRca.facts.flatMap((fact) => fact.evidenceRefs), ...structuredRca.symptoms.flatMap((symptom) => symptom.evidenceRefs)];
    const unknownRef = refs.find((ref) => !knownRefs.has(ref.trim().toLowerCase()));
    if (unknownRef) fail(`structuredRca contains unknown evidenceRef: ${unknownRef}`);
  }
  return { ...normalized, smartActions, confidence: raw.confidence, openQuestions: raw.openQuestions.map((item) => item.trim()), structuredRca };
}

export type ValidatedVisionResult = {
  visibleFacts: string[];
  possibleDefects: string[];
  hypotheses: string[];
  missingData: string[];
  recommendedChecks: string[];
  confidence: number;
};

export function normalizeAndValidateVision(input: unknown): ValidatedVisionResult {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
    } catch {
      fail("vision response is not valid JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("vision root must be an object");
  const raw = value as Record<string, unknown>;
  const fields = ["visibleFacts", "possibleDefects", "hypotheses", "missingData", "recommendedChecks"] as const;
  const result = {} as Record<(typeof fields)[number], string[]>;
  for (const field of fields) {
    if (!Array.isArray(raw[field]) || raw[field].some((item) => typeof item !== "string" || !item.trim())) fail(`vision ${field} must be an array of non-empty strings`);
    result[field] = raw[field].map((item) => item.trim());
  }
  if (typeof raw.confidence !== "number" || !Number.isInteger(raw.confidence) || raw.confidence < 0 || raw.confidence > 100) fail("vision confidence must be an integer from 0 to 100");
  return { ...result, confidence: raw.confidence };
}
