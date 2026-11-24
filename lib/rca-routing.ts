export type RcaPlatform = "web" | "native";

export const NATIVE_RCA_UNAVAILABLE_MESSAGE =
  "Локальный анализ на Android пока недоступен или не настроен. Данные расследования сохранены на устройстве; удалённый AI не вызывался.";

export function canUseRemoteRca(platform: RcaPlatform) {
  // Both web and native clients use the authenticated server RCA gateway.
  // Cache-only is enforced by analyzeCase before this helper is reached.
  return platform === "web" || platform === "native";
}
