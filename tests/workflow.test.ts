import { describe, expect, it } from "vitest";

import { PumpRcaRepository, MemoryStorageAdapter } from "../lib/domain-repository";
import { getAllowedTransitions, getStatusProgress, transitionInvestigation, validateTransition } from "../shared/domain/workflow";

async function fixture() {
  const repository = new PumpRcaRepository({ adapter: new MemoryStorageAdapter() });
  const pump = await repository.createPump({ assetTag: "P-101", equipmentType: "Центробежный насос", location: "Цех 2", metadata: {} });
  const investigation = await repository.createInvestigation({ pumpId: pump.id, title: "Падение подачи", narrative: "Вибрация и рост температуры подшипника", severity: "Высокий", tags: ["вибрация"] });
  return { repository, investigation };
}

describe("investigation workflow", () => {
  it("allows only configured next transitions", () => {
    expect(getAllowedTransitions("DRAFT").map((item) => item.to)).toEqual(["DATA_COLLECTION"]);
    expect(getAllowedTransitions("CLOSED")).toEqual([]);
    expect(getStatusProgress("PENDING_REVIEW")).toBe(70);
  });

  it("requires a reason when returning from review", async () => {
    const { repository, investigation } = await fixture();
    const state = await repository.getState();
    const review = { ...investigation, status: "PENDING_REVIEW" as const };
    const invalid = validateTransition(review, "ANALYSIS", state);
    expect(invalid.allowed).toBe(false);
    expect(invalid.reason).toContain("причину");
  });

  it("commits transition and audit atomically", async () => {
    const { repository, investigation } = await fixture();
    const dataCollection = await transitionInvestigation(repository, investigation.id, "DATA_COLLECTION");
    expect(dataCollection.status).toBe("DATA_COLLECTION");
    const events = await repository.getAuditEvents(investigation.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ oldValue: "DRAFT", newValue: "DATA_COLLECTION", action: "STATUS_CHANGED" });
  });

  it("rejects direct status mutation through repository replace", async () => {
    const { repository, investigation } = await fixture();
    await expect(repository.replaceInvestigation({ ...investigation, status: "ANALYSIS" })).rejects.toThrow(/workflow service/);
  });
});
