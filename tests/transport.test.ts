import { describe, expect, it, vi } from "vitest";
import { resolveApiBaseUrl } from "../lib/api-url";
import { buildTransportHeaders, extractTrpcErrorDetails, fetchJsonTransport } from "../lib/transport";

describe("API transport safety", () => {
  it("adds the native bearer token at the final fetch boundary", () => {
    const headers = buildTransportHeaders({ "Content-Type": "application/json" }, {
      platform: "native",
      sessionToken: "opaque-token",
      csrfToken: "browser-token-must-not-be-used",
    });
    expect(headers.get("authorization")).toBe("Bearer opaque-token");
    expect(headers.get("x-csrf-token")).toBeNull();
  });

  it("adds the browser double-submit token without inventing native auth", () => {
    const headers = buildTransportHeaders(undefined, { platform: "web", csrfToken: "browser-token" });
    expect(headers.get("x-csrf-token")).toBe("browser-token");
    expect(headers.get("authorization")).toBeNull();
  });

  it("rejects an HTML response before the JSON parser can see it", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html><html>error</html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    }));
    await expect(fetchJsonTransport("https://8081-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow("TRANSPORT_HTTP_ERROR: HTTP 404");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful non-JSON response as a transport error", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html><html>preview</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    await expect(fetchJsonTransport("https://8081-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow("TRANSPORT_NON_JSON_RESPONSE");
  });

  it("accepts JSON and preserves the response for tRPC", async () => {
    const response = new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    const fetchImpl = vi.fn(async () => response);
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).resolves.toBe(response);
  });

  it("classifies a known CSRF server error without exposing the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "CSRF validation failed", secret: "must-not-be-logged" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }));
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow("CSRF_VALIDATION_FAILED");
  });

  it("classifies tRPC auth codes from the structured error envelope", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { json: { data: { code: "FORBIDDEN" } } } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }));
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow("FORBIDDEN");
  });

  it("keeps an unknown JSON error generic instead of guessing its cause", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "unknown", details: "private" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }));
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow("TRANSPORT_HTTP_ERROR: HTTP 403.");
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [429, "TOO_MANY_REQUESTS"],
    [500, "INTERNAL_SERVER_ERROR"],
  ] as const)("extracts tRPC message/code safely for HTTP %s", async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { json: { message: "Request failed safely", data: { code, httpStatus: status } } } }), {
      status,
      headers: { "content-type": "application/json" },
    }));
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow(`HTTP ${status}`);
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow(code);
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow("Request failed safely");
  });

  it("includes RCA stage and Correlation ID but excludes unsafe fields", () => {
    const details = extractTrpcErrorDetails({
      error: {
        json: {
          message: "Сервер не смог завершить RCA-анализ. Этап: validation. Correlation ID: 12345678-1234-4234-8234-123456789abc.",
          data: {
            code: "INTERNAL_SERVER_ERROR",
            stage: "validation",
            correlationId: "12345678-1234-4234-8234-123456789abc",
            token: "must-not-be-exposed",
          },
        },
      },
    });
    expect(details).toEqual({
      message: expect.stringContaining("validation"),
      code: "INTERNAL_SERVER_ERROR",
      data: { stage: "validation", correlationId: "12345678-1234-4234-8234-123456789abc", httpStatus: undefined },
    });
    expect(JSON.stringify(details)).not.toContain("must-not-be-exposed");
  });

  it("surfaces RCA stage and Correlation ID in the transport error", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        json: {
          message: "Сервер не смог завершить RCA-анализ.",
          data: {
            code: "INTERNAL_SERVER_ERROR",
            stage: "analyst",
            correlationId: "12345678-1234-4234-8234-123456789abc",
          },
        },
      },
    }), { status: 500, headers: { "content-type": "application/json" } }));
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl))
      .rejects.toThrow("Stage: analyst. Идентификатор ошибки: 12345678-1234-4234-8234-123456789abc.");
  });

  it.each(["photo", "video", "document"] as const)("preserves the %s RCA stage in transport diagnostics", (stage) => {
    const details = extractTrpcErrorDetails({
      error: { json: { message: "RCA stage failed", data: { code: "INTERNAL_SERVER_ERROR", stage, correlationId: "12345678-1234-4234-8234-123456789abc" } } },
    });
    expect(details.data?.stage).toBe(stage);
  });

  it("does not expose unsafe server messages", () => {
    expect(extractTrpcErrorDetails({ error: { message: "Bearer secret-token" } })).toEqual({ message: undefined, code: undefined, data: undefined });
  });

  it.each([
    ["", "INVALID_RESPONSE"],
    ["not-json", "INVALID_RESPONSE"],
  ] as const)("keeps empty or malformed HTTP 500 response safe (%s)", async (body, marker) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status: 500, headers: { "content-type": "application/json" } }));
    await expect(fetchJsonTransport("https://3000-example.manus.com/api/trpc", undefined, fetchImpl)).rejects.toThrow(marker);
  });

  it("rejects Metro 8081 as an explicitly configured native API URL", () => {
    expect(() => resolveApiBaseUrl({ platform: "native", configured: "https://8081-example.manus.com" })).toThrow(/Metro web preview/);
    expect(resolveApiBaseUrl({ platform: "native", configured: "https://3000-example.manus.com" })).toBe("https://3000-example.manus.com");
  });

  it("derives the backend hostname from the web preview hostname", () => {
    expect(resolveApiBaseUrl({ platform: "web", hostname: "8081-example.manus.com", protocol: "https:" })).toBe("https://3000-example.manus.com");
  });

  it("uses the production same-origin API instead of a stale preview configuration", () => {
    expect(resolveApiBaseUrl({
      platform: "web",
      hostname: "pump-rca-ntbesymu.manus.space",
      protocol: "https:",
      configured: "https://3000-preview.manus.computer",
    })).toBe("https://pump-rca-ntbesymu.manus.space");
  });
});
