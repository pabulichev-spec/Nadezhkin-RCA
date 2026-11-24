import { useCallback, useMemo, useState } from "react";
import { Image } from "expo-image";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { PumpRcaRepository } from "@/lib/domain-repository";
import { subscribeDomainChanges } from "@/lib/domain-events";
import type { DomainState, Investigation } from "@/shared/domain/types";
import { filterInvestigations, type CaseFilter } from "@/shared/cases";

const statusLabels: Record<Investigation["status"], string> = {
  DRAFT: "Черновик", DATA_COLLECTION: "Сбор данных", ANALYSIS: "Анализ", PENDING_REVIEW: "На проверке", APPROVAL: "Согласование", APPROVED: "Утверждено", CLOSED: "Закрыто",
};
const statusColors: Record<Investigation["status"], string> = {
  DRAFT: "#8EA2BD", DATA_COLLECTION: "#F5B84B", ANALYSIS: "#2F8CFF", PENDING_REVIEW: "#B796FF", APPROVAL: "#B796FF", APPROVED: "#37D98B", CLOSED: "#37D98B",
};

export default function CasesScreen() {
  const colors = useColors();
  const router = useRouter();
  const repo = useMemo(() => new PumpRcaRepository(), []);
  const [state, setState] = useState<DomainState>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CaseFilter>("Все");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => setState(await repo.getState()), [repo]);
  useFocusEffect(useCallback(() => {
    void load();
    return subscribeDomainChanges(() => { void load(); });
  }, [load]));

  const cases = useMemo(() => filterInvestigations(state?.investigations ?? [], query, filter), [filter, query, state]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.topbar, { borderBottomColor: colors.border }]}><Pressable onPress={() => router.push("./index" as never)} style={styles.topbarBack}><MaterialIcons name="arrow-back" size={21} color={colors.primary} /></Pressable><Text style={[styles.topbarTitle, { color: colors.foreground }]}>Мои расследования</Text><View style={styles.topbarActions}><MaterialIcons name="search" size={21} color={colors.foreground} /><MaterialIcons name="tune" size={21} color={colors.foreground} /></View></View>
      <View style={styles.heading}><View><Text style={[styles.eyebrow, { color: colors.primary }]}>НАДЁЖКИН · РАССЛЕДОВАНИЯ</Text><Text style={[styles.title, { color: colors.foreground }]}>Все кейсы</Text><Text style={[styles.subtitle, { color: colors.muted }]}>От свидетельства до подтверждённой коренной причины.</Text></View><Pressable onPress={() => router.push("./index" as never)} style={[styles.addButton, { backgroundColor: colors.primary }]}><MaterialIcons name="add" size={21} color="#FFFFFF" /><Text style={styles.addText}>Новый</Text></Pressable></View>
      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name="search" size={21} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Поиск по кейсам…" placeholderTextColor={colors.muted} style={[styles.searchInput, { color: colors.foreground }]} /></View>
      <View style={styles.filters}>{(["Все", "Активные", "Закрытые"] as CaseFilter[]).map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, { backgroundColor: filter === item ? colors.primary : colors.surface, borderColor: filter === item ? colors.primary : colors.border }]}><Text style={[styles.filterText, { color: filter === item ? "#FFFFFF" : colors.muted }]}>{item}</Text></Pressable>)}</View>
      <Text style={[styles.count, { color: colors.muted }]}>{cases.length} из {state?.investigations.length ?? 0} расследований</Text>
      {cases.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name="folder-open" size={32} color={colors.muted} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Кейсы не найдены</Text><Text style={[styles.emptyText, { color: colors.muted }]}>Создайте расследование на главном экране или измените фильтр.</Text></View> : cases.map((item) => <CaseCard key={item.id} item={item} evidence={state?.evidence ?? []} colors={colors} onPress={() => router.push({ pathname: "./workspace", params: { id: item.id } })} />)}
    </ScrollView>
  </ScreenContainer>;
}

function CaseCard({ item, evidence, colors, onPress }: { item: Investigation; evidence: DomainState["evidence"]; colors: ReturnType<typeof useColors>; onPress: () => void }) {
  const evidenceCount = item.evidenceIds.length;
  const statusColor = statusColors[item.status];
  const preview = evidence.find((entry) => item.evidenceIds.includes(entry.id) && (entry.kind === "photo" || entry.kind === "video") && !!entry.uri);
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.caseCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.82 : 1 }]}><View style={[styles.caseAccent, { backgroundColor: statusColor }]} />{preview?.uri ? <Image source={{ uri: preview.uri }} contentFit="cover" style={styles.preview} /> : <View style={[styles.previewFallback, { backgroundColor: colors.background }]}><MaterialIcons name={preview?.kind === "video" ? "videocam" : "photo-camera"} size={25} color={colors.primary} /></View>}<View style={styles.caseMain}><View style={styles.caseTop}><Text numberOfLines={2} style={[styles.caseTitle, { color: colors.foreground }]}>{item.title}</Text><View style={[styles.badge, { backgroundColor: `${statusColor}22` }]}><View style={[styles.dot, { backgroundColor: statusColor }]} /><Text style={[styles.badgeText, { color: statusColor }]}>{statusLabels[item.status]}</Text></View></View><Text numberOfLines={2} style={[styles.caseNarrative, { color: colors.muted }]}>{item.narrative || "Описание расследования не заполнено"}</Text><View style={styles.meta}><Text style={[styles.metaText, { color: colors.muted }]}>{evidenceCount} материалов</Text><Text style={[styles.metaText, { color: colors.muted }]}>{item.tags[0] || "Насосное оборудование"}</Text><MaterialIcons name="chevron-right" size={20} color={colors.muted} /></View></View></Pressable>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 13, paddingBottom: 34 },
  topbar: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  topbarBack: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  topbarTitle: { flex: 1, fontSize: 16, fontWeight: "900" },
  topbarActions: { flexDirection: "row", gap: 14 },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 29, fontWeight: "900", marginTop: 4 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 270 },
  addButton: { minHeight: 42, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", gap: 5, alignItems: "center" },
  addText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },
  searchBox: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: "row", gap: 8, alignItems: "center" },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 0 },
  filters: { flexDirection: "row", gap: 8 },
  filter: { minHeight: 35, paddingHorizontal: 13, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 11, fontWeight: "800" },
  count: { fontSize: 11, marginTop: 2 },
  caseCard: { minHeight: 148, borderWidth: 1, borderRadius: 17, overflow: "hidden", flexDirection: "row", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  caseAccent: { width: 4 },
  preview: { width: 86, minHeight: 136 },
  previewFallback: { width: 86, minHeight: 136, alignItems: "center", justifyContent: "center" },
  caseMain: { flex: 1, padding: 14, gap: 8 },
  caseTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  caseTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "900" },
  caseNarrative: { fontSize: 12, lineHeight: 17 },
  meta: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: "auto" },
  metaText: { fontSize: 10 },
  empty: { minHeight: 190, borderWidth: 1, borderRadius: 18, padding: 20, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "900" },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center" },
});
