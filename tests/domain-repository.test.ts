import { describe, expect, it } from "vitest";

import { migrateDomainStorage, migrateLegacyCases, normalizeDomainState } from "../shared/domain/migration";
import { DOMAIN_SCHEMA_VERSION } from "../shared/domain/types";
import { LEGACY_CASES_STORAGE_KEY, MemoryStorageAdapter, PumpRcaRepository } from "../lib/domain-repository";

describe("PumpRCA domain migration", () => {
  it("migrates legacy PumpCase data without requiring the legacy schema to change", () => {
    const legacy = [{
      id: "case-1",
      title: "Вибрация P-204",
      equipmentType: "Центробежный насос",
      assetTag: "P-204",
      location: "Цех 2",
      severity: "Высокий",
      status: "В работе",
      narrative: "Рост вибрации",
      tags: ["вибрация"],
      evidence: [{ id: "e-1", kind: "photo", name: "bearing.jpg", note: "след перегрева" }],
      updatedAt: "2026-09-25T10:00:00.000Z",
      result: { physicalCause: "Рабочая гипотеза" },
    }];

    const state = migrateLegacyCases(legacy);
    expect(state.schemaVersion).toBe(DOMAIN_SCHEMA_VERSION);
    expect(state.pumps[0]).toMatchObject({ assetTag: "P-204", equipmentType: "Центробежный насос" });
    expect(state.investigations[0]).toMatchObject({ id: "case-1", status: "DRAFT", legacyCaseId: "case-1" });
    expect(state.investigations[0].legacyData).toMatchObject({ title: "Вибрация P-204", result: { physicalCause: "Рабочая гипотеза" } });
    expect(state.evidence[0]).toMatchObject({ id: "evidence-e-1", investigationId: "case-1", name: "bearing.jpg" });
  });

  it("normalizes partial domain state and preserves the schema version", () => {
    const state = normalizeDomainState({ schemaVersion: 1, pumps: [{ id: "p1" }] });
    expect(state.schemaVersion).toBe(DOMAIN_SCHEMA_VERSION);
    expect(state.pumps).toHaveLength(1);
    expect(state.investigations).toEqual([]);
    expect(state.auditLog).toEqual([]);
  });

  it("prefers an existing v2 domain snapshot over legacy input", () => {
    const existing = migrateDomainStorage({ schemaVersion: 2, pumps: [{ id: "new-pump" }] }, [{ id: "old-case" }]);
    expect(existing.pumps.map((pump) => pump.id)).toEqual(["new-pump"]);
    expect(existing.investigations).toEqual([]);
  });
});

describe("PumpRcaRepository", () => {
  it("persists new pumps and investigations through the storage adapter", async () => {
    const adapter = new MemoryStorageAdapter();
    const repository = new PumpRcaRepository({ adapter });
    const pump = await repository.createPump({ assetTag: "P-101", equipmentType: "Центробежный насос", metadata: {} });
    const investigation = await repository.createInvestigation({ pumpId: pump.id, title: "Проверка насоса", narrative: "Проверка после остановки" });

    const reloaded = new PumpRcaRepository({ adapter });
    expect(await reloaded.listInvestigations()).toHaveLength(1);
    expect(await reloaded.getInvestigation(investigation.id)).toMatchObject({ pumpId: pump.id, title: "Проверка насоса", status: "DRAFT" });
  });

  it("initializes a v2 snapshot from legacy data and leaves it readable after reload", async () => {
    const adapter = new MemoryStorageAdapter();
    const repository = new PumpRcaRepository({
      adapter,
      legacyCases: [{ id: "legacy-7", title: "Legacy case", equipmentType: "Погружной насос", assetTag: "S-7", evidence: [] }],
    });

    const first = await repository.listInvestigations();
    const second = await new PumpRcaRepository({ adapter, legacyCases: [{ id: "different", title: "Should not replace" }] }).listInvestigations();
    expect(first.map((item) => item.id)).toEqual(["legacy-7"]);
    expect(second.map((item) => item.id)).toEqual(["legacy-7"]);
  });

  it("reads the real legacy AsyncStorage key only when the v2 snapshot is absent", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(LEGACY_CASES_STORAGE_KEY, JSON.stringify([{ id: "legacy-key", title: "From v1", equipmentType: "Шламовый насос", evidence: [] }]));
    const repository = new PumpRcaRepository({ adapter });

    expect((await repository.listInvestigations())[0]).toMatchObject({ id: "legacy-key", title: "From v1" });
    await adapter.setItem(LEGACY_CASES_STORAGE_KEY, JSON.stringify([{ id: "should-not-win", title: "Old replacement" }]));
    expect((await repository.listInvestigations())[0].id).toBe("legacy-key");
  });

  it("updates only an existing investigation and rejects unknown ids", async () => {
    const repository = new PumpRcaRepository({ adapter: new MemoryStorageAdapter() });
    const created = await repository.createInvestigation({ title: "Case", narrative: "Facts" });
    const updated = await repository.replaceInvestigation({ ...created, title: "Updated case" });
    expect(updated.title).toBe("Updated case");
    await expect(repository.replaceInvestigation({ ...created, id: "missing" })).rejects.toThrow("Investigation not found");
  });

  it("persists structured RCA alongside legacy result fields and restores it", async () => {
    const repository = new PumpRcaRepository({ adapter: new MemoryStorageAdapter() });
    const created = await repository.createInvestigation({ title: "Structured case", narrative: "Рост вибрации" });
    const structuredRca = { facts: [{ statement: "Рост вибрации зафиксирован", source: "USER_PROVIDED", evidenceRefs: ["shift-log"] }], symptoms: [{ statement: "Повышенная вибрация", evidenceRefs: ["shift-log"] }], hypotheses: [{ statement: "Возможна несоосность", supportingFactIndexes: [0], confidence: 30, status: "OPEN" }], missingData: ["Нет протокола центровки"] };
    const result = { executiveSummary: "Предварительный вывод", physicalCause: "Гипотеза", humanFactor: "Не установлено", systemicCause: "Не установлено", smartActions: [], confidence: 30, openQuestions: ["Нужен замер"], methodNotes: "Предварительно", structuredRca };
    await repository.replaceInvestigation({ ...created, legacyData: { result, rcaResultSchemaVersion: 2 } });
    const reloaded = await repository.getInvestigation(created.id);
    expect((reloaded?.legacyData as Record<string, unknown>)?.result).toMatchObject({ structuredRca, physicalCause: "Гипотеза" });
  });

  it("persists a categorized cause tree and five why answers", async () => {
    const repository = new PumpRcaRepository({ adapter: new MemoryStorageAdapter() });
    const investigation = await repository.createInvestigation({ title: "Дерево причин", narrative: "Остановка насоса" });
    await repository.saveCause({ id: "cause-root", investigationId: investigation.id, type: "PHYSICAL_CAUSE", title: "Разрушение уплотнения", description: "Следы перегрева", sortOrder: 0, evidenceIds: [] });
    await repository.saveCause({ id: "cause-child", investigationId: investigation.id, parentId: "cause-root", type: "HYPOTHESIS_CONFIRMED", title: "Недостаточная промывка", description: "Подтверждено журналом", sortOrder: 0, evidenceIds: [] });
    await repository.replaceInvestigation({ ...investigation, fiveWhys: [
      { id: "why-1", level: 1, why: "Почему остановился насос?", answer: "Сработала защита", evidenceIds: [] },
      { id: "why-2", level: 2, why: "Почему сработала защита?", answer: "Выросла температура", evidenceIds: [] },
    ] });
    const reloaded = await repository.getState();
    expect(reloaded.causes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cause-root", type: "PHYSICAL_CAUSE" }),
      expect.objectContaining({ id: "cause-child", parentId: "cause-root", type: "HYPOTHESIS_CONFIRMED" }),
    ]));
    expect(reloaded.investigations[0].fiveWhys).toHaveLength(2);
    expect(reloaded.investigations[0].fiveWhys?.[1].answer).toBe("Выросла температура");
  });

  it("deletes pumps from both stores while preserving and detaching investigations", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(LEGACY_CASES_STORAGE_KEY, JSON.stringify([{ id: "case-delete", assetTag: "P-204", title: "Вибрация" }]));
    const repository = new PumpRcaRepository({ adapter });
    const state = await repository.getState();
    const pump = state.pumps[0];
    const result = await repository.deletePumps([pump.id]);
    expect(result.deleted).toBe(1);
    expect((await repository.getState()).pumps).toHaveLength(0);
    expect((await repository.getState()).investigations).toHaveLength(1);
    expect((await repository.getState()).investigations[0].pumpId).toBeUndefined();
    expect(JSON.parse((await adapter.getItem(LEGACY_CASES_STORAGE_KEY)) ?? "[]")[0].pumpRemovedAt).toBeTypeOf("string");
  });

  it("removes only the selected evidence and updates the investigation link", async () => {
    const repository = new PumpRcaRepository({ adapter: new MemoryStorageAdapter() });
    const investigation = await repository.createInvestigation({ title: "Case", narrative: "Facts" });
    await repository.saveEvidence({ id: "evidence-1", investigationId: investigation.id, kind: "file", name: "report.pdf", uri: "file:///report.pdf", createdAt: new Date().toISOString(), linkedHypothesisIds: [], linkedCauseNodeIds: [], linkedTaskIds: [] });
    await repository.replaceInvestigation({ ...investigation, evidenceIds: ["evidence-1"] });
    await repository.deleteEvidence("evidence-1", investigation.id);
    expect((await repository.getState()).evidence).toHaveLength(0);
    expect((await repository.getInvestigation(investigation.id))?.evidenceIds).toEqual([]);
  });
});
