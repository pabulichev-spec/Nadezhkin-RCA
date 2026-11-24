import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { PumpRcaRepository } from "@/lib/domain-repository";
import { subscribeDomainChanges } from "@/lib/domain-events";
import type { DomainState, Investigation, Pump } from "@/shared/domain/types";
import { getEquipmentStatus } from "@/shared/equipment-metrics";

const Icon = MaterialIcons;

type PumpFilter = "В работе" | "Требует внимания" | "Готово к эксплуатации";

function relatedInvestigations(pump: Pump, state: DomainState) {
  return state.investigations.filter((item) => item.pumpId === pump.id);
}

export default function PumpsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const repo = useMemo(() => new PumpRcaRepository(), []);
  const [state, setState] = useState<DomainState>();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<PumpFilter | "Все">((filter as PumpFilter) || "Все");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState({ assetTag: "", equipmentType: "Центробежный насос", location: "" });
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = useCallback(async () => setState(await repo.getState()), [repo]);
  useFocusEffect(useCallback(() => {
    refresh().catch(() => undefined);
    return subscribeDomainChanges(() => { refresh().catch(() => undefined); });
  }, [refresh]));
  useEffect(() => { if (filter === "В работе" || filter === "Требует внимания" || filter === "Готово к эксплуатации") setActiveFilter(filter); }, [filter]);

  const pumps = state?.pumps ?? [];
  const filtered = pumps.filter((pump) => {
    const matchesQuery = `${pump.assetTag} ${pump.equipmentType} ${pump.location ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (activeFilter === "Все" || getEquipmentStatus(pump, state!) === activeFilter);
  });

  const save = async () => {
    if (!state || !draft.assetTag.trim()) return Alert.alert("Не указан тег", "Введите тег актива насоса.");
    if (editing) {
      const old = state.pumps.find((pump) => pump.id === editing);
      if (old) {
        await repo.save({ ...state, pumps: state.pumps.map((pump) => pump.id === editing ? { ...old, ...draft, updatedAt: new Date().toISOString() } : pump) });
      }
    } else {
      await repo.createPump({ ...draft, metadata: {} });
    }
    setDraft({ assetTag: "", equipmentType: "Центробежный насос", location: "" });
    setEditing(null);
    await refresh();
  };

  const removePumps = async (ids: string[]) => {
    if (!ids.length) return;
    const result = await repo.deletePumps(ids);
    setSelectedIds([]);
    await refresh();
    if (result.deleted === 0) throw new Error("Насос не найден в хранилище.");
    Alert.alert("Удаление выполнено", `Удалено насосов: ${result.deleted}. Связанные расследования сохранены.`);
  };

  const confirmRemove = (pump: Pump) => {
    Alert.alert("Удалить насос?", `Будет удалён только насос «${pump.assetTag}». Связанные расследования и доказательства сохранятся.`, [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => removePumps([pump.id]).catch(() => Alert.alert("Ошибка", "Насос не удалось удалить.")) },
    ]);
  };

  const confirmSelected = () => {
    if (!selectedIds.length) return Alert.alert("Ничего не выбрано", "Отметьте насосы, которые нужно удалить.");
    Alert.alert("Удалить выбранные насосы?", `Будет удалено записей: ${selectedIds.length}. Расследования и доказательства не удаляются.`, [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => removePumps(selectedIds).catch(() => Alert.alert("Ошибка", "Выбранные насосы не удалось удалить.")) },
    ]);
  };

  const confirmAll = () => {
    if (!pumps.length) return Alert.alert("Список пуст", "Нет насосов для удаления.");
    Alert.alert("Удалить все насосы?", `Будут удалены все записи: ${pumps.length}. Расследования и доказательства сохранятся.`, [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить все", style: "destructive", onPress: () => removePumps(pumps.map((pump) => pump.id)).catch(() => Alert.alert("Ошибка", "Насосы не удалось удалить.")) },
    ]);
  };

  const openPump = (pump: Pump) => {
    if (selectionMode) {
      setSelectedIds((current) => current.includes(pump.id) ? current.filter((id) => id !== pump.id) : [...current, pump.id]);
      return;
    }
    const related = relatedInvestigations(pump, state!);
    if (related.length === 1) return router.push({ pathname: "./workspace", params: { id: related[0].id } });
    if (related.length === 0) return Alert.alert("Расследований нет", "Для этого насоса пока нет расследований. Создайте кейс на экране «Мои расследования».", [{ text: "Понятно" }, { text: "Открыть кейсы", onPress: () => router.push("./index" as never) }]);
    Alert.alert("Выберите расследование", "У насоса найдено несколько связанных кейсов.", [{ text: "Отмена", style: "cancel" }, ...related.slice(0, 3).map((item: Investigation) => ({ text: item.title, onPress: () => router.push({ pathname: "./workspace", params: { id: item.id } }) }))]);
  };

  const renderDeleteAction = (pump: Pump) => <Pressable onPress={() => confirmRemove(pump)} style={styles.swipeDelete}><Icon name="delete-outline" size={22} color="#FFFFFF" /><Text style={styles.swipeDeleteText}>Удалить</Text></Pressable>;

  return <ScreenContainer className="p-4">
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={[styles.topbar, { borderBottomColor: colors.border }]}><Pressable onPress={() => router.push("./index" as never)} style={styles.topbarBack}><Icon name="arrow-back" size={21} color={colors.primary} /></Pressable><Text style={[styles.topbarTitle, { color: colors.foreground }]}>Реестр насосов</Text><Icon name="notifications-none" size={21} color={colors.foreground} /></View>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={[styles.kicker, { color: colors.primary }]}>РЕЕСТР ОБОРУДОВАНИЯ</Text><Text style={[styles.title, { color: colors.foreground }]}>Насосы</Text><Text style={{ color: colors.muted }}>Состояние, расследования и управление списком</Text></View>
        <Pressable accessibilityLabel="Управление насосами" onPress={() => { setSelectionMode((value) => !value); setSelectedIds([]); }} style={[styles.iconButton, { backgroundColor: selectionMode ? colors.primary : colors.surface, borderColor: colors.border }]}><Icon name="settings" size={23} color={selectionMode ? "#FFFFFF" : colors.primary} /></Pressable>
      </View>
      {selectionMode && <View style={[styles.selectionBar, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.selectionTitle, { color: colors.foreground }]}>Выбрано: {selectedIds.length}</Text><View style={styles.selectionActions}><Pressable onPress={() => setSelectedIds(filtered.map((pump) => pump.id))}><Text style={[styles.selectionLink, { color: colors.primary }]}>Выбрать все</Text></Pressable><Pressable onPress={confirmSelected}><Text style={[styles.selectionDanger, { color: colors.error }]}>Удалить выбранные</Text></Pressable><Pressable onPress={confirmAll}><Text style={[styles.selectionDanger, { color: colors.error }]}>Удалить все</Text></Pressable><Pressable onPress={() => { setSelectionMode(false); setSelectedIds([]); }}><Text style={[styles.selectionLink, { color: colors.muted }]}>Отмена</Text></Pressable></View></View>}
      <TextInput value={query} onChangeText={setQuery} placeholder="Поиск по тегу, типу или локации" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>{(["Все", "В работе", "Требует внимания", "Готово к эксплуатации"] as const).map((item) => <Pressable key={item} onPress={() => setActiveFilter(item)} style={[styles.filterChip, { backgroundColor: activeFilter === item ? colors.primary : colors.surface, borderColor: activeFilter === item ? colors.primary : colors.border }]}><Text style={{ color: activeFilter === item ? "#FFFFFF" : colors.foreground, fontWeight: "800", fontSize: 12 }}>{item}</Text></Pressable>)}</ScrollView>
      <View style={[styles.form, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.section, { color: colors.primary }]}>{editing ? "РЕДАКТИРОВАТЬ НАСОС" : "ДОБАВИТЬ НАСОС"}</Text><TextInput value={draft.assetTag} onChangeText={(value) => setDraft({ ...draft, assetTag: value })} placeholder="Тег актива, например P-204" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} /><TextInput value={draft.equipmentType} onChangeText={(value) => setDraft({ ...draft, equipmentType: value })} placeholder="Тип оборудования" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} /><TextInput value={draft.location} onChangeText={(value) => setDraft({ ...draft, location: value })} placeholder="Локация" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} /><Pressable onPress={save} style={[styles.primary, { backgroundColor: colors.primary }]}><Text style={styles.primaryText}>{editing ? "Сохранить изменения" : "Создать насос"}</Text></Pressable></View>
      <Text style={[styles.count, { color: colors.muted }]}>Показано насосов: {filtered.length} из {pumps.length}</Text>
      {filtered.map((pump) => {
        const status = getEquipmentStatus(pump, state!);
        const related = relatedInvestigations(pump, state!);
        return <Swipeable key={pump.id} renderRightActions={() => renderDeleteAction(pump)} overshootRight={false}><Pressable onPress={() => openPump(pump)} style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: selectedIds.includes(pump.id) ? colors.primary : colors.border, opacity: pressed ? 0.78 : 1 }]}><View style={[styles.checkBox, { borderColor: selectedIds.includes(pump.id) ? colors.primary : colors.border, backgroundColor: selectedIds.includes(pump.id) ? colors.primary : "transparent" }]}>{selectedIds.includes(pump.id) && <Icon name="check" size={15} color="#FFFFFF" />}</View><View style={{ flex: 1 }}><View style={styles.cardTop}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{pump.assetTag}</Text><Text style={[styles.status, { color: status === "Требует внимания" ? colors.primary : status === "В работе" ? colors.warning : colors.success }]}>{status}</Text></View><Text style={{ color: colors.muted }}>{pump.equipmentType} · {pump.location || "Локация не указана"}</Text><Text style={{ color: colors.primary, marginTop: 8 }}>Расследований: {related.length}</Text></View>{!selectionMode && <Pressable onPress={() => { setEditing(pump.id); setDraft({ assetTag: pump.assetTag, equipmentType: pump.equipmentType, location: pump.location ?? "" }); }} hitSlop={8}><Icon name="edit" size={21} color={colors.primary} /></Pressable>}</Pressable></Swipeable>;
      })}
      {!filtered.length && <View style={[styles.empty, { borderColor: colors.border }]}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Насосы не найдены</Text><Text style={{ color: colors.muted, textAlign: "center", marginTop: 6 }}>Измените фильтр или добавьте новую запись.</Text></View>}
    </ScrollView>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  topbar: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  topbarBack: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  topbarTitle: { flex: 1, fontSize: 16, fontWeight: "900" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 27, fontWeight: "900", marginTop: 4 },
  iconButton: { width: 46, height: 46, borderWidth: 1, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  selectionBar: { borderWidth: 1, borderRadius: 16, padding: 13, marginBottom: 12 },
  selectionTitle: { fontWeight: "900", marginBottom: 9 },
  selectionActions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  selectionLink: { fontWeight: "800", fontSize: 12 },
  selectionDanger: { fontWeight: "800", fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 10, fontSize: 15 },
  filterChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, marginRight: 8 },
  form: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 },
  section: { fontSize: 12, fontWeight: "800", marginBottom: 12 },
  primary: { borderRadius: 14, padding: 14, alignItems: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "800" },
  count: { fontSize: 12, fontWeight: "700", marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: "800" },
  status: { fontSize: 11, fontWeight: "800", flexShrink: 1 },
  checkBox: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  swipeDelete: { backgroundColor: "#B83A32", borderRadius: 15, marginBottom: 10, width: 90, alignItems: "center", justifyContent: "center", gap: 3 },
  swipeDeleteText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  empty: { borderWidth: 1, borderRadius: 18, padding: 24, alignItems: "center" },
});
