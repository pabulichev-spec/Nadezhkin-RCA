import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { clearAiCache, readAiUsage } from "@/lib/ai-cache";
import { EMPTY_AI_USAGE, type AiUsageStats } from "@/shared/ai";

export default function UsageScreen() {
  const colors = useColors();
  const [usage, setUsage] = useState<AiUsageStats>(EMPTY_AI_USAGE);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => setUsage(await readAiUsage()), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const clearCache = () => Alert.alert("Очистить кэш AI?", "Сохранённые результаты будут удалены. Следующий одинаковый запрос снова обратится к модели.", [
    { text: "Отмена", style: "cancel" },
    { text: "Очистить", style: "destructive", onPress: async () => { await clearAiCache(); Alert.alert("Готово", "Кэш AI очищен."); } },
  ]);

  const totalCalls = usage.rcaCalls + usage.chatCalls;
  const hitRate = usage.cacheHits + usage.cacheMisses > 0 ? Math.round((usage.cacheHits / (usage.cacheHits + usage.cacheMisses)) * 100) : 0;

  return <ScreenContainer className="p-5" edges={["top", "left", "right"]}>
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.content}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>AI / ИСПОЛЬЗОВАНИЕ</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Расход AI и кэш</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>Локальная статистика этого приложения. Обновите экран, чтобы увидеть последние сохранённые данные.</Text>

      <View style={[styles.notice, { backgroundColor: "#FFF8F3", borderColor: "#F6D6C8" }]}><MaterialIcons name="info-outline" size={21} color={colors.primary} /><Text style={[styles.noticeText, { color: colors.foreground }]}>Реальный баланс Manus-кредитов не передаётся мобильному приложению через доступный API. Поэтому здесь не показывается вымышленный остаток; актуальный баланс проверяется в аккаунте Manus.</Text></View>

      <View style={styles.grid}><Stat label="AI-вызовов" value={String(totalCalls)} colors={colors} icon="auto-awesome" /><Stat label="RCA-анализов" value={String(usage.rcaCalls)} colors={colors} icon="analytics" /><Stat label="Вопросов в чате" value={String(usage.chatCalls)} colors={colors} icon="forum" /><Stat label="Попаданий в кэш" value={`${usage.cacheHits} · ${hitRate}%`} colors={colors} icon="cached" /></View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Как приложение экономит вызовы</Text><Text style={[styles.cardText, { color: colors.muted }]}>Одинаковый RCA-запрос и одинаковый вопрос в чате сохраняются на устройстве на 7 дней. Повторный запрос возвращается из кэша без обращения к модели. Изменение материалов, описания или истории создаёт новый ключ кэша.</Text><Pressable onPress={clearCache} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}><MaterialIcons name="delete-sweep" size={18} color={colors.primary} /><Text style={[styles.secondaryText, { color: colors.foreground }]}>Очистить кэш AI</Text></Pressable></View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Оптимизация промптов</Text><Text style={[styles.cardText, { color: colors.muted }]}>Повторяющиеся инструкции сокращены, контекст передаётся компактными полями, а строгая JSON-схема сохраняется. Это уменьшает входной текст без отказа от требований RCA и SMART.</Text><Pressable onPress={() => Linking.openURL("https://help.manus.im")} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}><MaterialIcons name="open-in-new" size={17} color={colors.primary} /><Text style={[styles.secondaryText, { color: colors.foreground }]}>Проверить баланс в Manus Help</Text></Pressable></View>

      {usage.lastActivityAt && <Text style={[styles.updated, { color: colors.muted }]}>Последняя активность: {new Date(usage.lastActivityAt).toLocaleString("ru-RU")}</Text>}
    </ScrollView>
  </ScreenContainer>;
}

function Stat({ label, value, icon, colors }: { label: string; value: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}><MaterialIcons name={icon} size={20} color={colors.primary} /><Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text><Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 30 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 28, fontWeight: "800", marginTop: -5 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  notice: { borderWidth: 1, borderRadius: 15, padding: 13, flexDirection: "row", gap: 9, alignItems: "flex-start" },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  stat: { width: "48%", minHeight: 105, borderWidth: 1, borderRadius: 15, padding: 13, gap: 5 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11 },
  card: { borderWidth: 1, borderRadius: 17, padding: 15, gap: 9 },
  cardTitle: { fontSize: 15, fontWeight: "800" },
  cardText: { fontSize: 12, lineHeight: 18 },
  secondaryButton: { minHeight: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  secondaryText: { fontSize: 12, fontWeight: "800" },
  updated: { fontSize: 10, textAlign: "center" },
});
