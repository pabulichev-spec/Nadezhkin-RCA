import { describe, expect, it } from "vitest";

import { filterInvestigations } from "../shared/cases";
import type { Investigation } from "../shared/domain/types";

const makeCase = (overrides: Partial<Investigation>): Investigation => ({
  id: "case-1",
  pumpId: "pump-1",
  title: "Падение давления",
  narrative: "Нестабильная работа насоса",
  severity: "Высокий",
  status: "DRAFT",
  tags: ["давление"],
  evidenceIds: [],
  hypothesisIds: [],
  taskIds: [],
  causeNodeIds: [],
  actionIds: [],
  createdAt: "2026-11-01T08:00:00.000Z",
  updatedAt: "2026-11-01T09:00:00.000Z",
  statusChangedAt: "2026-11-01T09:00:00.000Z",
  ...overrides,
});

describe("case filters", () => {
  it("searches across title, narrative and tags", () => {
    const items = [makeCase({ id: "case-1", tags: ["кавитация"] }), makeCase({ id: "case-2", title: "Перегрев подшипника", tags: ["температура"] })];
    expect(filterInvestigations(items, "кавитация", "Все").map((item) => item.id)).toEqual(["case-1"]);
    expect(filterInvestigations(items, "ПЕРЕГРЕВ", "Все").map((item) => item.id)).toEqual(["case-2"]);
  });

  it("separates active and closed investigations", () => {
    const items = [makeCase({ id: "active", status: "ANALYSIS" }), makeCase({ id: "closed", status: "CLOSED", updatedAt: "2026-11-02T09:00:00.000Z" })];
    expect(filterInvestigations(items, "", "Активные").map((item) => item.id)).toEqual(["active"]);
    expect(filterInvestigations(items, "", "Закрытые").map((item) => item.id)).toEqual(["closed"]);
  });
});
