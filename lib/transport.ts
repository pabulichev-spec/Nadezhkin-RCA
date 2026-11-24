export type TransportStage = "trpc_transport" | "api_health" | "photo" | "video" | "document" | "technical" | "analyst" | "critic" | "composer" | "validation" | "save";

export type TransportDiagnostic = {
  stage: TransportStage;
  url: string;
  status?: number;
  contentType?: string;
  code:
    | "ORIGIN_NOT_ALLOWED"
    | "CSRF_VALIDATION_FAILED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "HTTP_ERROR"
    | "NON_JSON_RESPONSE"
    | "NETWORK_ERROR"
    | "INVALID_RESPONSE";
};

export type TrpcErrorDetails = {
  message?: string;
  code?: string;
  data?: {
    stage?: string;
    correlationId?: string;
    httpStatus?: number;
  };
};

export function getBrowserCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(/(?:^|;\s*)pumprca_csrf=([^;]+)/)?.[1];
}

export function buildTransportHeaders(
  base: HeadersInit | undefined,
  options: { platform: "web" | "native"; sessionToken?: string | null; csrfToken?: string },
): Headers {
  const headers = new Headers(base);
  if (options.platform === "native" && options.sessionToken) {
    headers.set("Authorization", `Bearer ${options.sessionToken}`);
  }
  if (options.platform === "web" && options.csrfToken) {
    headers.set("X-CSRF-Token", options.csrfToken);
  }
  return headers;
}

function safeUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

function contentTypeOf(response: Response) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
}

function reportTransportDiagnostic(diagnostic: TransportDiagnostic) {
  // Deliberately excludes request/response bodies, auth headers, tokens and user data.
  console.warn("[PumpRCA transport]", JSON.stringify(diagnostic));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function firstEnvelope(payload: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(payload)) return asRecord(payload[0]);
  return asRecord(payload);
}

function safeCorrelationId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value) ? value : undefined;
}

function safeStage(value: unknown) {
  return typeof value === "string" && /^(photo|video|document|technical|analyst|critic|composer|validation|save)$/.test(value) ? value : undefined;
}

function safeHttpStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

function safeServerMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const message = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 280);
  if (!message || /(?:bearer\s+|sk-[a-z0-9]|sk-or-v1-|api[_-]?key|authorization:|cookie:|stack trace|node_modules|\/home\/|\bat\s+\S+\(?\S+:\d+:\d+\)?)/i.test(message)) return undefined;
  return message;
}

export function extractTrpcErrorDetails(payload: unknown): TrpcErrorDetails {
  const root = firstEnvelope(payload);
  const error = asRecord(root?.error) ?? root;
  const json = asRecord(error?.json);
  const data = asRecord(error?.data) ?? asRecord(json?.data);
  const message = safeServerMessage(error?.message ?? json?.message ?? root?.message);
  const codeValue = data?.code ?? error?.code ?? json?.code;
  const code = typeof codeValue === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(codeValue) ? codeValue : undefined;
  const stage = safeStage(data?.stage);
  const correlationId = safeCorrelationId(data?.correlationId);
  const httpStatus = safeHttpStatus(data?.httpStatus);
  return {
    message,
    code,
    data: stage || correlationId || httpStatus ? { stage, correlationId, httpStatus } : undefined,
  };
}

function classifyKnownServerError(payload: unknown): TransportDiagnostic["code"] {
  const details = extractTrpcErrorDetails(payload);
  if (details.code === "UNAUTHORIZED" || details.code === "FORBIDDEN") return details.code;
  const root = firstEnvelope(payload);
  if (root?.error === "Origin not allowed") return "ORIGIN_NOT_ALLOWED";
  if (root?.error === "CSRF validation failed") return "CSRF_VALIDATION_FAILED";
  return "HTTP_ERROR";
}

function formatTransportError(status: number, code: TransportDiagnostic["code"], details: TrpcErrorDetails) {
  const parts = [`TRANSPORT_HTTP_ERROR: HTTP ${status}${code === "HTTP_ERROR" ? "." : ` (${code}).`}`];
  if (details.code && details.code !== code) parts.push(`Code: ${details.code}.`);
  if (details.message) parts.push(details.message);
  if (details.data?.stage) parts.push(`Stage: ${details.data.stage}.`);
  if (details.data?.correlationId) parts.push(`Идентификатор ошибки: ${details.data.correlationId}.`);
  return parts.join(" ");
}

export async function fetchJsonTransport(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = safeUrl(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  let response: Response;
  try {
    response = await fetchImpl(input, init);
  } catch {
    const diagnostic: TransportDiagnostic = { stage: "trpc_transport", url, code: "NETWORK_ERROR" };
    reportTransportDiagnostic(diagnostic);
    throw new Error("TRANSPORT_NETWORK_ERROR: backend request could not be completed.");
  }

  const contentType = contentTypeOf(response);
  if (!response.ok) {
    let code: TransportDiagnostic["code"] = "HTTP_ERROR";
    let details: TrpcErrorDetails = {};
    if (contentType === "application/json" || contentType === "application/json-seq") {
      try {
        const payload = await response.clone().json();
        details = extractTrpcErrorDetails(payload);
        code = classifyKnownServerError(payload);
      } catch {
        code = "INVALID_RESPONSE";
      }
    }
    const diagnostic: TransportDiagnostic = { stage: "trpc_transport", url, status: response.status, contentType, code };
    reportTransportDiagnostic(diagnostic);
    throw new Error(formatTransportError(response.status, code, details));
  }
  if (contentType !== "application/json" && contentType !== "application/json-seq") {
    const diagnostic: TransportDiagnostic = { stage: "trpc_transport", url, status: response.status, contentType, code: "NON_JSON_RESPONSE" };
    reportTransportDiagnostic(diagnostic);
    throw new Error(`TRANSPORT_NON_JSON_RESPONSE: expected application/json, received ${contentType || "unknown"}.`);
  }
  return response;
}
