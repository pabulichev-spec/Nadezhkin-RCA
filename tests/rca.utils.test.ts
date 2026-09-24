import { describe, expect, it } from "vitest";

import { formatRcaEvidence, getConfidenceBand, hasActionableRca } from "../shared/rca";

describe("RCA utilities", () => {
  it("maps confidence to an interpretable band", () => {
    expect(getConfidenceBand(82)).toBe("high");
    expect(getConfidenceBand(61)).toBe("medium");
    expect(getConfidenceBand(24)).toBe("low");
  });

  it("formats evidence without inventing a note", () => {
    expect(formatRcaEvidence("photo", "bearing.jpg")).toBe("PHOTO — bearing.jpg.");
    expect(formatRcaEvidence("text", "shift log", "  vibration 8.4 mm/s  ")).toBe("TEXT — shift log. Примечание: vibration 8.4 mm/s");
  });

  it("accepts only actionable RCA output", () => {
    expect(hasActionableRca({ rootCause: "Process gap", recommendations: [{ action: "Add check" }], openQuestions: [] })).toBe(true);
    expect(hasActionableRca({ rootCause: "", recommendations: [{ action: "Add check" }], openQuestions: [] })).toBe(false);
    expect(hasActionableRca({ rootCause: "Process gap", recommendations: [], openQuestions: [] })).toBe(false);
  });
});
