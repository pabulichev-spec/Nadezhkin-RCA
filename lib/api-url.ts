export function normalizeApiBaseUrl(value: string, source = "EXPO_PUBLIC_API_BASE_URL") {
  const normalized = value.trim().replace(/\/$/, "");
  if (!normalized) return "";
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`API_CONFIG_INVALID: ${source} must be an absolute http(s) URL.`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`API_CONFIG_INVALID: ${source} must use http or https.`);
  }
  if (parsed.port === "8081" || /^8081-/.test(parsed.hostname)) {
    throw new Error("API_CONFIG_INVALID: Metro web preview (8081) cannot be used as the API backend.");
  }
  return normalized;
}

export function resolveApiBaseUrl(options: { platform: "web" | "native"; configured?: string; protocol?: string; hostname?: string }) {
  if (options.platform === "web" && options.hostname) {
    const protocol = options.protocol || "https:";
    if (/^8081-/.test(options.hostname)) {
      const apiHostname = options.hostname.replace(/^8081-/, "3000-");
      return `${protocol}//${apiHostname}`;
    }
    return `${protocol}//${options.hostname}`;
  }

  const configured = normalizeApiBaseUrl(options.configured ?? "");
  if (configured) return configured;

  throw new Error("API_CONFIG_MISSING: EXPO_PUBLIC_API_BASE_URL is required for native builds.");
}
