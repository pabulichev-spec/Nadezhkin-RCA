import type { Investigation } from "@/shared/domain/types";

export type CaseFilter = "Все" | "Активные" | "Закрытые";

export function filterInvestigations(items: Investigation[], query: string, filter: CaseFilter) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  return items
    .filter((item) => {
      const haystack = `${item.title} ${item.narrative} ${item.tags.join(" ")}`.toLocaleLowerCase("ru-RU");
      const matchesQuery = !normalized || haystack.includes(normalized);
      const isClosed = item.status === "APPROVED" || item.status === "CLOSED";
      const matchesFilter = filter === "Все" || (filter === "Активные" && !isClosed) || (filter === "Закрытые" && isClosed);
      return matchesQuery && matchesFilter;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
