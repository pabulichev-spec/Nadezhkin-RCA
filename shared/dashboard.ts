export type DashboardCaseLike = {
  status: "В работе" | "Готово";
  severity: string;
};

export function getDashboardMetrics(cases: DashboardCaseLike[]) {
  const completed = cases.filter((item) => item.status === "Готово").length;
  const active = cases.length - completed;
  const critical = cases.filter((item) => item.severity === "Критический").length;
  const attention = cases.filter((item) => item.severity === "Высокий" || item.severity === "Критический").length;
  return { total: cases.length, active, completed, critical, attention };
}
