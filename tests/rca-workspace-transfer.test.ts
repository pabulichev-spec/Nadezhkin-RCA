import { describe, expect, it } from "vitest";
import { emptyDomainState } from "../shared/domain/types";
import { createRcaTasks, getCompletion, confirmRootCause } from "../shared/domain/rca-workspace";
import { exportInvestigation, importArchive, parseArchive, serializeArchive } from "../lib/pumprca-transfer";

describe("RCA workspace", () => {
  it("creates exactly 16 numbered tasks and gates review", () => {
    const state = emptyDomainState(); state.pumps.push({ id: "p1", assetTag: "P-1", equipmentType: "Центробежный насос", metadata: {}, createdAt: "now", updatedAt: "now" });
    const investigation = { id: "i1", pumpId: "p1", title: "Отказ", narrative: "Вибрация", status: "ANALYSIS" as const, tags: [], evidenceIds: [], hypothesisIds: ["h1"], taskIds: [], causeNodeIds: [], actionIds: [], createdAt: "now", updatedAt: "now", statusChangedAt: "now" };
    state.investigations.push(investigation); state.hypotheses.push({ id: "h1", investigationId: "i1", title: "Гипотеза", status: "NEW", supportingEvidenceIds: [], contradictingEvidenceIds: [], createdAt: "now", updatedAt: "now" }); state.tasks.push(...createRcaTasks("i1")); state.evidence.push({ id: "e1", investigationId: "i1", kind: "photo", name: "x", createdAt: "now", linkedHypothesisIds: [], linkedCauseNodeIds: [], linkedTaskIds: [] });
    const completion = getCompletion(state, investigation); expect(state.tasks).toHaveLength(16); expect(completion.readyForReview).toBe(true); expect(completion.readyForApproval).toBe(false);
  });
  it("requires engineer confirmation for root cause", () => { const base = { id: "i", title: "x", narrative: "y", status: "ANALYSIS" as const, tags: [], evidenceIds: [], hypothesisIds: [], taskIds: [], causeNodeIds: [], actionIds: [], createdAt: "n", updatedAt: "n", statusChangedAt: "n" }; expect(() => confirmRootCause(base, { statement: "", type: "Technical", evidenceIds: [], hypothesisIds: [] })).toThrow(); expect(confirmRootCause(base, { statement: "Износ", type: "Technical", evidenceIds: [], hypothesisIds: [], confirmedBy: "Инженер" }).rootCause?.confirmedBy).toBe("Инженер"); });
});
describe("pumprca transfer", () => { it("exports and imports a complete investigation", () => { const state = emptyDomainState(); state.investigations.push({ id: "i1", title: "RCA", narrative: "event", status: "DRAFT", tags: [], evidenceIds: [], hypothesisIds: [], taskIds: [], causeNodeIds: [], actionIds: [], createdAt: "now", updatedAt: "now", statusChangedAt: "now" }); const archive = exportInvestigation(state, "i1"); const roundTrip = parseArchive(serializeArchive(archive)); const imported = importArchive(emptyDomainState(), roundTrip); expect(imported.investigations[0].id).toBe("i1"); }); });
