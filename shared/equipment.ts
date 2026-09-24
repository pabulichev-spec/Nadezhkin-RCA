export const EQUIPMENT_TYPES = [
  "Центробежный насос", "Шламовый насос", "Дозировочный", "Консольный насос",
  "Герметичный насос (с экранированным двигателем)", "Поршневой насос", "Плунжерный насос",
  "Диафрагменный (мембранный) насос", "Винтовой насос", "Шестерённый насос", "Вихревой насос",
  "Осевой насос", "Радиально-поршневой насос", "Многосекционный насос", "Погружной насос", "Вакуумный насос",
] as const;

export function filterEquipmentTypes(query: string) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  return EQUIPMENT_TYPES.filter((type) => !normalized || type.toLocaleLowerCase("ru-RU").includes(normalized));
}

export function isKnownEquipmentType(value: string) {
  return EQUIPMENT_TYPES.includes(value as typeof EQUIPMENT_TYPES[number]);
}
