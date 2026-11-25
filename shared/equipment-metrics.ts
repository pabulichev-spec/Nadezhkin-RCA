import type { DomainState, Pump } from "./domain/types";

export type EquipmentStatus = "В работе" | "Требует внимания" | "Готово к эксплуатации";

export function getEquipmentStatus(pump: Pump, state: DomainState): EquipmentStatus {
  const explicit = pump.metadata?.status as EquipmentStatus | undefined;
  if (explicit === "В работе" || explicit === "Требует внимания" || explicit === "Готово к эксплуатации") return explicit;

  const related = state.investigations.filter((item) => item.pumpId === pump.id);
  if (related.some((item) => item.severity === "Критический" || item.severity === "Высокий")) return "Требует внимания";
  if (related.some((item) => !["APPROVED", "CLOSED"].includes(item.status))) return "В работе";
  return "Готово к эксплуатации";
}

export function getStatusForEquipment(equipmentId: string, state: DomainState): EquipmentStatus {
  const legacyPump = state.pumps.find((pump) => pump.id === equipmentId);
  return legacyPump ? getEquipmentStatus(legacyPump, state) : "Готово к эксплуатации";
}

export function getEquipmentMetrics(state: DomainState) {
  const counts = { total: state.pumps.length, active: 0, attention: 0, ready: 0 };
  for (const pump of state.pumps) {
    const status = getEquipmentStatus(pump, state);
    if (status === "В работе") counts.active += 1;
    else if (status === "Требует внимания") counts.attention += 1;
    else counts.ready += 1;
  }
  return counts;
}
