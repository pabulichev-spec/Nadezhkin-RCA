import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter, PumpRcaRepository } from "../lib/domain-repository";
import { migrateDomainStorage } from "../shared/domain/migration";
import { EQUIPMENT_GROUPS, getEquipmentGroup } from "../shared/equipment";

describe("universal equipment catalog", () => {
  it("contains dynamic and static groups with selectable models", () => {
    expect(EQUIPMENT_GROUPS.some((group) => group.id === "compressors" && group.kind === "dynamic")).toBe(true);
    expect(EQUIPMENT_GROUPS.some((group) => group.id === "centrifuges" && group.models.length > 1)).toBe(true);
    expect(EQUIPMENT_GROUPS.some((group) => group.id === "motors")).toBe(true);
    expect(EQUIPMENT_GROUPS.some((group) => group.id === "columns" && group.kind === "static")).toBe(true);
    expect(getEquipmentGroup("compressors")?.models).toContain("Винтовой компрессор");
  });

  it("creates a universal equipment record and a compatible legacy pump record with the same ID", async () => {
    const repository = new PumpRcaRepository({ adapter: new MemoryStorageAdapter() });
    const equipment = await repository.createEquipment({
      assetTag: "K-101",
      groupId: "compressors",
      groupLabel: "Компрессоры",
      kind: "dynamic",
      model: "Винтовой компрессор",
      location: "Цех 2",
      characteristics: { pressure: "8 bar" },
      capabilities: ["давление", "вибрация"],
      components: [],
      measurements: [],
      history: [],
    });
    const state = await repository.getState();
    expect(state.equipment).toHaveLength(1);
    expect(state.equipment[0]).toMatchObject({ id: equipment.id, groupId: "compressors", model: "Винтовой компрессор" });
    expect(state.pumps).toContainEqual(expect.objectContaining({ id: equipment.id, equipmentType: "Винтовой компрессор" }));
  });

  it("backfills old pumps into equipment without changing their IDs or investigation links", () => {
    const state = migrateDomainStorage({
      schemaVersion: 3,
      pumps: [{ id: "pump-old-1", assetTag: "P-101", equipmentType: "Центробежный насос", metadata: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
      investigations: [{ id: "case-1", pumpId: "pump-old-1", title: "Отказ", narrative: "", status: "DRAFT", tags: [], evidenceIds: [], hypothesisIds: [], taskIds: [], causeNodeIds: [], actionIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", statusChangedAt: "2026-01-01" }],
    });
    expect(state.pumps[0].id).toBe("pump-old-1");
    expect(state.equipment[0]).toMatchObject({ id: "pump-old-1", legacyPumpId: "pump-old-1", groupId: "pumps" });
    expect(state.investigations[0].pumpId).toBe("pump-old-1");
  });
});
