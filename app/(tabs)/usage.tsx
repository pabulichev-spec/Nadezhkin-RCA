import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { clearAiCache, getAllowedCacheTtlDays, getCacheTtlDays, readAiUsage, setCacheTtlDays, type CacheTtlDays } from "@/lib/ai-cache";
import { PumpRcaRepository } from "@/lib/domain-repository";
import { emptyDomainState, type DomainState } from "@/shared/domain/types";
import { EMPTY_AI_USAGE, type AiUsageStats } from "@/shared/ai";

export default function UsageScreen() {
  const colors = useColors();
  const repo = useMemo(() => new PumpRcaRepository(), []);
  const [usage, setUsage] = useState<AiUsageStats>(EMPTY_AI_USAGE);
  const [domain, setDomain] = useState<DomainState>(emptyDomainState());
  const [cacheTtlDays, setCacheTtlDaysState] = useState<CacheTtlDays>(7);
  const [period, setPeriod] = useState("Все время");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [nextUsage, nextTtl, nextDomain] = await Promise.all([readAiUsage(), getCacheTtlDays(), repo.getState()]);
    setUsage(nextUsage);
    setCacheTtlDaysState(nextTtl);
    setDomain(nextDomain);
  }, [repo]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const clearCache = () => Alert.alert("Очистить кэш ИИ?", "Сохранённые результаты будут удалены. Следующий одинаковый запрос снова обратится к модели.", [
    { text: "Отмена", style: "cancel" },
    { text: "Очистить", style: "destructive", onPress: async () => { await clearAiCache(); Alert.alert("Готово", "Кэш ИИ очищен."); } },
  ]);

  const totalCalls = usage.rcaCalls + usage.chatCalls;
  const cacheTotal = usage.cacheHits + usage.cacheMisses;
  const hitRate = cacheTotal > 0 ? Math.round((usage.cacheHits / cacheTotal) * 100) : 0;
  const statusRows = useMemo(() => {
    const rows = [
      { label: "Активные", value: domain.investigations.filter((item) => ["DRAFT", "DATA_COLLECTION", "ANALYSIS"].includes(item.status)).length, color: colors.primary },
      { label: "На проверке", value: domain.investigations.filter((item) => ["PENDING_REVIEW", "APPROVAL"].includes(item.status)).length, color: colors.warning },
      { label: "Закрытые", value: domain.investigations.filter((item) => ["APPROVED", "CLOSED"].includes(item.status)).length, color: colors.success },
    ];
    return rows;
  }, [colors, domain.investigations]);
  const maxStatus = Math.max(...statusRows.map((row) => row.value), 1);
  const reliabilityScore = domain.investigations.length ? Math.round((statusRows.find((row) => row.label === "Закрытые")?.value ?? 0) / domain.investigations.length * 1000) / 10 : 0;
  const equipmentRows = useMemo(() => domain.pumps.map((pump) => ({
    label: pump.assetTag || pump.equipmentType,
    value: domain.investigations.filter((item) => item.pumpId === pump.id).length,
  })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 5), [domain]);
  const causeRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cause of domain.causes) counts.set(cause.title, (counts.get(cause.title) ?? 0) + 1);
    for (const investigation of domain.investigations) if (investigation.rootCause?.statement) counts.set(investigation.rootCause.statement, (counts.get(investigation.rootCause.statement) ?? 0) + 1);
    return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [domain]);

  return <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heading}><View><Text style={[styles.eyebrow, { color: colors.primary }]}>НАДЁЖКИН · АНАЛИТИКА</Text><Text style={[styles.title, { color: colors.foreground }]}>Аналитика</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Фактическая картина расследований и состояния оборудования.</Text></View><View style={[styles.headerIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name="bar-chart" size={24} color={colors.primary} /></View></View>

      <View style={styles.periodRow}>{["7 дней", "30 дней", "Все время"].map((item) => <Pressable key={item} onPress={() => setPeriod(item)} style={[styles.periodChip, { backgroundColor: period === item ? colors.primary : colors.surface, borderColor: period === item ? colors.primary : colors.border }]}><Text style={[styles.periodText, { color: period === item ? "#FFFFFF" : colors.muted }]}>{item}</Text></Pressable>)}</View>

      <View style={styles.grid}><Stat label="Кейсов" value={String(domain.investigations.length)} colors={colors} icon="assignment" /><Stat label="Насосов" value={String(domain.pumps.length)} colors={colors} icon="settings-input-component" /><Stat label="Материалов" value={String(domain.evidence.length)} colors={colors} icon="perm-media" /><Stat label="Запросов к ИИ" value={String(totalCalls)} colors={colors} icon="auto-awesome" /></View>

      <View style={[styles.reliabilityCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.cardHeading}><View><Text style={[styles.cardTitle, { color: colors.foreground }]}>Надёжность оборудования</Text><Text style={[styles.cardHint, { color: colors.muted }]}>Доля закрытых расследований · {period}</Text></View><Text style={[styles.reliabilityValue, { color: colors.success }]}>{reliabilityScore}%</Text></View><View style={styles.sparkline}>{statusRows.map((row, index) => <View key={row.label} style={styles.sparkColumn}><View style={[styles.sparkBar, { height: 18 + Math.min(row.value * 18, 58), backgroundColor: index === 2 ? colors.success : index === 1 ? colors.warning : colors.primary }]} /><Text style={[styles.sparkLabel, { color: colors.muted }]}>{index + 1}</Text></View>)}</View><Text style={[styles.cardText, { color: colors.muted }]}>Показатель считается по фактически сохранённым статусам кейсов и не является прогнозом.</Text></View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.cardHeading}><View><Text style={[styles.cardTitle, { color: colors.foreground }]}>Кейсы по статусам</Text><Text style={[styles.cardHint, { color: colors.muted }]}>Период: {period}</Text></View><MaterialIcons name="donut-small" size={22} color={colors.primary} /></View>{domain.investigations.length === 0 ? <Empty text="Недостаточно данных для распределения." colors={colors} /> : <View style={styles.chart}>{statusRows.map((row) => <View key={row.label} style={styles.barRow}><Text style={[styles.barLabel, { color: colors.muted }]}>{row.label}</Text><View style={[styles.barTrack, { backgroundColor: colors.background }]}><View style={[styles.barFill, { width: `${Math.max((row.value / maxStatus) * 100, row.value ? 5 : 0)}%`, backgroundColor: row.color }]} /></View><Text style={[styles.barValue, { color: row.color }]}>{row.value}</Text></View>)}</View>}</View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.cardHeading}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Рейтинг оборудования</Text><MaterialIcons name="leaderboard" size={22} color={colors.primary} /></View>{equipmentRows.length === 0 ? <Empty text="Связанные расследования пока не сохранены." colors={colors} /> : equipmentRows.map((row, index) => <RankRow key={row.label} index={index + 1} label={row.label} value={row.value} colors={colors} />)}</View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.cardHeading}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Частые причины</Text><MaterialIcons name="account-tree" size={22} color={colors.primary} /></View>{causeRows.length === 0 ? <Empty text="Причины появятся после сохранения дерева причин или результата RCA." colors={colors} /> : causeRows.map((row) => <RankRow key={row.label} index={undefined} label={row.label} value={row.value} colors={colors} />)}</View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Использование ИИ и кэша</Text><View style={styles.aiSummary}><Stat label="Попаданий в кэш" value={`${usage.cacheHits} · ${hitRate}%`} colors={colors} icon="cached" /><Stat label="Анализов причин" value={String(usage.rcaCalls)} colors={colors} icon="analytics" /></View><Text style={[styles.cardText, { color: colors.muted }]}>Разрешённые бесплатные маршруты работают через защищённый сервер. Повторные запросы возвращаются из кэша устройства на {cacheTtlDays} дн.</Text><View style={styles.ttlRow}>{getAllowedCacheTtlDays().map((days) => <Pressable key={days} onPress={async () => { await setCacheTtlDays(days); setCacheTtlDaysState(days); }} style={[styles.ttlButton, { backgroundColor: cacheTtlDays === days ? colors.primary : colors.background, borderColor: cacheTtlDays === days ? colors.primary : colors.border }]}><Text style={[styles.ttlText, { color: cacheTtlDays === days ? "#FFFFFF" : colors.foreground }]}>{days} дн.</Text></Pressable>)}</View><Pressable onPress={clearCache} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}><MaterialIcons name="delete-sweep" size={18} color={colors.primary} /><Text style={[styles.secondaryText, { color: colors.foreground }]}>Очистить кэш</Text></Pressable></View>

      {usage.lastActivityAt && <Text style={[styles.updated, { color: colors.muted }]}>Последняя активность: {new Date(usage.lastActivityAt).toLocaleString("ru-RU")}</Text>}
    </ScrollView>
  </ScreenContainer>;
}

function Stat({ label, value, icon, colors }: { label: string; value: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name={icon} size={19} color={colors.primary} /><Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text><Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text></View>;
}

function RankRow({ index, label, value, colors }: { index?: number; label: string; value: number; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.rankRow}>{<View style={[styles.rankBadge, { backgroundColor: index ? colors.primary : colors.background }]}><Text style={[styles.rankNumber, { color: index ? "#FFFFFF" : colors.muted }]}>{index ?? "•"}</Text></View>}<Text numberOfLines={2} style={[styles.rankLabel, { color: colors.foreground }]}>{label}</Text><Text style={[styles.rankValue, { color: colors.primary }]}>{value}</Text></View>;
}

function Empty({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.empty, { backgroundColor: colors.background }]}><MaterialIcons name="info-outline" size={18} color={colors.muted} /><Text style={[styles.emptyText, { color: colors.muted }]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 34 },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 29, fontWeight: "900", marginTop: 4 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  headerIcon: { width: 50, height: 50, borderWidth: 1, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: { minHeight: 36, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  periodText: { fontSize: 11, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  stat: { width: "48%", minHeight: 99, borderWidth: 1, borderRadius: 15, padding: 13, gap: 5 },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { fontSize: 11 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 11 },
  cardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardHint: { fontSize: 10, marginTop: 3 },
  chart: { gap: 11 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 82, fontSize: 11 },
  barTrack: { flex: 1, height: 9, borderRadius: 99, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 99 },
  barValue: { width: 22, textAlign: "right", fontSize: 12, fontWeight: "900" },
  rankRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9 },
  rankBadge: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rankNumber: { fontSize: 11, fontWeight: "900" },
  rankLabel: { flex: 1, fontSize: 12, lineHeight: 16 },
  rankValue: { fontSize: 14, fontWeight: "900" },
  empty: { minHeight: 52, borderRadius: 12, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  emptyText: { flex: 1, fontSize: 11, lineHeight: 16 },
  aiSummary: { flexDirection: "row", gap: 9 },
  cardText: { fontSize: 12, lineHeight: 18 },
  reliabilityCard: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 12 },
  reliabilityValue: { fontSize: 22, fontWeight: "900" },
  sparkline: { height: 86, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", borderBottomWidth: 1, borderBottomColor: "#29415D", paddingHorizontal: 8 },
  sparkColumn: { alignItems: "center", justifyContent: "flex-end", gap: 5 },
  sparkBar: { width: 24, borderRadius: 8 },
  sparkLabel: { fontSize: 9 },
  secondaryButton: { minHeight: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  secondaryText: { fontSize: 12, fontWeight: "800" },
  ttlRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ttlButton: { minWidth: 58, minHeight: 36, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 9 },
  ttlText: { fontSize: 11, fontWeight: "800" },
  updated: { fontSize: 10, textAlign: "center" },
});
