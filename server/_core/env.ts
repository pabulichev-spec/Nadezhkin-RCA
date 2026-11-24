const isProduction = process.env.NODE_ENV === "production";

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterGeneralModel: process.env.OPENROUTER_GENERAL_MODEL ?? "",
  openRouterReasoningModel: process.env.OPENROUTER_REASONING_MODEL ?? "",
  openRouterVisionModel: process.env.OPENROUTER_VISION_MODEL ?? "",
  omniRouteBaseUrl: process.env.OMNIROUTE_BASE_URL ?? "",
  omniRouteApiKey: process.env.OMNIROUTE_API_KEY ?? "",
  omniRouteFreeModels: (process.env.OMNIROUTE_FREE_MODELS ?? "")
    .split(",")
    .map((model: string) => model.trim())
    .filter(Boolean),
  omniRouteEnabled: process.env.OMNIROUTE_ENABLED === "true",
  omniRouteZeroCostConfirmed: process.env.OMNIROUTE_ZERO_COST_CONFIRMED === "true",
  multiAgentEnabled: process.env.PUMPRCA_MULTI_AGENT_ENABLED === "true",
  explicitAllowedOrigins: (process.env.PUMPRCA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin: string) => origin.trim())
    .filter(Boolean),
  allowedOrigins: [
    process.env.PUMPRCA_ALLOWED_ORIGINS ?? "",
    ...(isProduction ? [] : [
      process.env.EXPO_WEB_PREVIEW_URL ?? "",
      process.env.EXPO_PACKAGER_PROXY_URL ?? "",
    ]),
  ]
    .join(",")
    .split(",")
    .map((origin: string) => origin.trim())
    .filter(Boolean),
  sessionCookieDomain: process.env.PUMPRCA_SESSION_COOKIE_DOMAIN ?? "",
};

export function assertProductionSecurityConfig(config: typeof ENV = ENV) {
  if (!config.isProduction) return;
  if (config.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters in production.");
  }
  if (!config.appId || !config.oAuthServerUrl) {
    throw new Error("OAuth application configuration is required in production.");
  }
  const configuredOrigins = config.explicitAllowedOrigins ?? config.allowedOrigins ?? [];
  if (configuredOrigins.length === 0) {
    throw new Error("PUMPRCA_ALLOWED_ORIGINS must contain at least one origin in production.");
  }
}
