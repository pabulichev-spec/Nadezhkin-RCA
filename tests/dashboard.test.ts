import { describe, expect, it } from "vitest";
import { getDashboardMetrics } from "../shared/dashboard";

describe("getDashboardMetrics", () => {
  it("counts active, completed, critical and attention cases", () => {
    expect(getDashboardMetrics([
      { status: "В работе", severity: "Высокий" },
      { status: "Готово", severity: "Средний" },
      { status: "В работе", severity: "Критический" },
    ])).toEqual({ total: 3, active: 2, completed: 1, critical: 1, attention: 2 });
  });

  it("returns a safe zero state for an empty registry", () => {
    expect(getDashboardMetrics([])).toEqual({ total: 0, active: 0, completed: 0, critical: 0, attention: 0 });
  });
});
