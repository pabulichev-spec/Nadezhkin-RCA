// Native release builds must not depend on a preview URL or build-machine env.
// This is a public origin, not a credential; session tokens remain in SecureStore.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://pump-rca-ntbesymu.manus.space";
