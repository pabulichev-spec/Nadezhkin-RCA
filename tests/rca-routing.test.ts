import { describe, expect, it } from "vitest";
import { canUseRemoteRca, NATIVE_RCA_UNAVAILABLE_MESSAGE } from "../lib/rca-routing";

describe("RCA platform routing", () => {
  it("keeps remote RCA available for web", () => {
    expect(canUseRemoteRca("web")).toBe(true);
  });

  it("routes native RCA to the authenticated server gateway", () => {
    expect(canUseRemoteRca("native")).toBe(true);
    expect(NATIVE_RCA_UNAVAILABLE_MESSAGE).toContain("Локальный анализ на Android");
  });
});
