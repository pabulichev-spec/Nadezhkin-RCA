import { describe, expect, it } from "vitest";

describe("OpenRouter server secret", () => {
  it("authenticates against the lightweight models endpoint without logging the key", async () => {
    const key = process.env.OPENROUTER_API_KEY;
    expect(key, "OPENROUTER_API_KEY must be present in the server test runtime").toBeTruthy();

    const response = await fetch("https://openrouter.ai/api/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data?: unknown[] };
    expect(Array.isArray(payload.data)).toBe(true);
  }, 30_000);
});
