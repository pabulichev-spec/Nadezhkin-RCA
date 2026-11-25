import { describe, expect, it } from "vitest";

import { emptyDomainState } from "../shared/domain/types";
import { getEquipmentMetrics, getEquipmentStatus, getStatusForEquipment } from "../shared/equipment-metrics";

describe("equipment metrics", () => {
  it("uses the same pump and investigation state for all equipment counters", () => {
    const state = emptyDomainState();
    state.pumps = [
      { id: "pump-1", assetTag: "P-101", equipmentType: "Центробежный насос", metadata: {}, createdAt: "2026-11-01", updatedAt: "2026-11-01" },
      { id: "pump-2", assetTag: "P-102", equipmentType: "Центробежный насос", metadata: {}, createdAt: "2026-11-01", updatedAt: "2026-11-01" },
      { id: "pump-3", assetTag: "P-103", equipmentType: "Центробежный насос", metadata: { status: "Готово к эксплуатации" }, createdAt: "2026-11-01", updatedAt: "2026-11-01" },
    ];
    state.investigations = [
      { id: "case-1", pumpId: "pump-1", title: "Высокая вибрация", narrative: "Рост вибрации", severity: "Высокий", status: "DRAFT", tags: [], evidenceIds: [], hypothesisIds: [], taskIds: [], causeNodeIds: [], actionIds: [], createdAt: "2026-11-01", updatedAt: "2026-11-01", statusChangedAt: "2026-11-01" },
      { id: "case-2", pumpId: "pump-2", title: "Плановая проверка", narrative: "Проверка", severity: "Средний", status: "APPROVED", tags: [], evidenceIds: [], hypothesisIds: [], taskIds: [], causeNodeIds: [], actionIds: [], createdAt: "2026-11-01", updatedAt: "2026-11-01", statusChangedAt: "2026-11-01" },
    ];

    expect(getEquipmentStatus(state.pumps[0], state)).toBe("Требует внимания");
    expect(getEquipmentStatus(state.pumps[1], state)).toBe("Готово к эксплуатации");
    expect(getEquipmentMetrics(state)).toEqual({ total: 3, active: 0, attention: 1, ready: 2 });
  });

  it("does not crash for universal Equipment without a legacy Pump", () => {
    const state = emptyDomainState();
    expect(getStatusForEquipment("compressor-1", state)).toBe("Готово к эксплуатации");
    expect(getStatusForEquipment("missing-equipment", state)).toBe("Готово к эксплуатации");
  });
});
