export type EquipmentKind = "dynamic" | "static";

export type EquipmentGroup = {
  id: string;
  label: string;
  kind: EquipmentKind;
  description: string;
  models: readonly string[];
  capabilities: readonly string[];
};

export const EQUIPMENT_GROUPS = [
  { id: "pumps", label: "Насосы", kind: "dynamic", description: "Перекачка жидкостей и суспензий", models: ["Центробежный насос", "Шламовый насос", "Дозировочный насос", "Консольный насос", "Герметичный насос (с экранированным двигателем)", "Поршневой насос", "Плунжерный насос", "Диафрагменный (мембранный) насос", "Винтовой насос", "Шестерённый насос", "Вихревой насос", "Осевой насос", "Радиально-поршневой насос", "Многосекционный насос", "Погружной насос", "Вакуумный насос", "Самовсасывающий насос", "Магнитный насос", "Двухвинтовой насос", "Трёхвинтовой насос", "Насос с двойным торцевым уплотнением", "Насос высокого давления"], capabilities: ["расход", "напор", "давление", "вибрация", "температура"] },
  { id: "compressors", label: "Компрессоры", kind: "dynamic", description: "Сжатие воздуха и технологических газов", models: ["Центробежный компрессор", "Поршневой компрессор", "Винтовой компрессор", "Мембранный компрессор", "Осевой компрессор", "Газодувка Рутса", "Пластинчато-роторный компрессор", "Спиральный компрессор", "Турбокомпрессор", "Детандер-компрессор", "Компрессор природного газа", "Компрессор холодильной установки"], capabilities: ["производительность", "степень сжатия", "давление", "температура", "вибрация"] },
  { id: "centrifuges", label: "Центрифуги", kind: "dynamic", description: "Разделение фаз вращением", models: ["Осадительная центрифуга", "Фильтрующая центрифуга", "Тарельчатый сепаратор", "Декантер", "Центрифуга периодического действия", "Центрифуга непрерывного действия", "Трубчатая центрифуга", "Лабораторная центрифуга", "Газовая центрифуга", "Центрифуга для обезвоживания шлама"], capabilities: ["скорость вращения", "производительность", "вибрация", "температура"] },
  { id: "motors", label: "Электродвигатели", kind: "dynamic", description: "Электрический привод оборудования", models: ["Асинхронный двигатель", "Синхронный двигатель", "Взрывозащищённый двигатель", "Двигатель постоянного тока", "Высоковольтный электродвигатель", "Двигатель с частотным преобразователем", "Двигатель с короткозамкнутым ротором", "Серводвигатель", "Шаговый двигатель", "Генератор-двигатель"], capabilities: ["мощность", "ток", "напряжение", "обороты", "температура обмоток"] },
  { id: "fans", label: "Вентиляторы и дымососы", kind: "dynamic", description: "Перемещение воздуха и газов", models: ["Радиальный вентилятор", "Осевой вентилятор", "Дымосос", "Газовый вентилятор"], capabilities: ["расход", "давление", "обороты", "вибрация"] },
  { id: "gearboxes", label: "Редукторы", kind: "dynamic", description: "Передача и преобразование крутящего момента", models: ["Цилиндрический редуктор", "Конический редуктор", "Планетарный редуктор", "Червячный редуктор"], capabilities: ["момент", "передаточное отношение", "температура масла", "вибрация"] },
  { id: "mixers", label: "Мешалки и аппараты с перемешиванием", kind: "dynamic", description: "Перемешивание технологической среды", models: ["Пропеллерная мешалка", "Якорная мешалка", "Турбинная мешалка", "Высокоскоростной диспергатор"], capabilities: ["обороты", "момент", "мощность", "температура"] },
  { id: "columns", label: "Колонны", kind: "static", description: "Массообменные и разделительные аппараты", models: ["Ректификационная колонна", "Абсорбционная колонна", "Отпарная колонна", "Насадочная колонна", "Тарельчатая колонна"], capabilities: ["давление", "температура", "уровень", "перепад давления"] },
  { id: "vessels", label: "Аппараты и сосуды", kind: "static", description: "Технологические ёмкости под давлением и без давления", models: ["Сосуд под давлением", "Реактор", "Сепаратор", "Фильтр-аппарат", "Автоклав"], capabilities: ["давление", "температура", "уровень", "коррозия"] },
  { id: "tanks", label: "Резервуары и ёмкости", kind: "static", description: "Хранение сырья, продуктов и реагентов", models: ["Вертикальный резервуар", "Горизонтальная ёмкость", "Резервуар хранения", "Буферная ёмкость", "Мерник"], capabilities: ["уровень", "температура", "давление", "герметичность"] },
  { id: "heat-exchangers", label: "Теплообменники", kind: "static", description: "Передача тепла между потоками", models: ["Кожухотрубчатый теплообменник", "Пластинчатый теплообменник", "Воздушный охладитель", "Конденсатор", "Испаритель"], capabilities: ["температура входа", "температура выхода", "расход", "перепад давления"] },
] as const satisfies readonly EquipmentGroup[];

/** Legacy pump choices remain available to old cases and IDs. */
export const EQUIPMENT_TYPES = EQUIPMENT_GROUPS.find((group) => group.id === "pumps")!.models;

export function getEquipmentGroup(groupId: string) {
  return EQUIPMENT_GROUPS.find((group) => group.id === groupId);
}

export function filterEquipmentGroups(query: string) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  return EQUIPMENT_GROUPS.filter((group) => !normalized || `${group.label} ${group.description}`.toLocaleLowerCase("ru-RU").includes(normalized));
}

export function filterEquipmentTypes(query: string) {
  const normalized = query.trim().toLocaleLowerCase("ru-RU");
  return EQUIPMENT_GROUPS.flatMap((group) => group.models).filter((type) => !normalized || type.toLocaleLowerCase("ru-RU").includes(normalized));
}

export function isKnownEquipmentType(value: string) {
  return EQUIPMENT_GROUPS.some((group) => (group.models as readonly string[]).includes(value));
}
