import { ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const steps = [
  { number: "01", icon: "fact-check", title: "Зафиксировать факт", text: "Что отказало, когда, при каких режимах и что сделал оператор? Отделите наблюдение от интерпретации." },
  { number: "02", icon: "timeline", title: "Собрать цепочку событий", text: "Выстройте последовательность от нормальной работы до остановки. Фотографии, видео и журналы становятся свидетельствами." },
  { number: "03", icon: "account-tree", title: "Разделить причины", text: "Различайте непосредственную причину, способствующие факторы и корневую причину в системе управления." },
  { number: "04", icon: "security", title: "Проверить барьеры", text: "Какие защиты должны были предотвратить отказ? Были ли они спроектированы, доступны и фактически использованы?" },
  { number: "05", icon: "task-alt", title: "Сформировать действия", text: "Рекомендации должны менять условия системы: процесс, конструкцию, контроль или компетенции — не только «напомнить быть внимательнее»." },
] as const;

const qualityChecks = [
  ["Факт", "Подтверждён наблюдением или измерением"],
  ["Гипотеза", "Объясняет факт и может быть проверена"],
  ["Причина", "Устраняется изменением системы"],
  ["Действие", "Имеет владельца и срок проверки"],
];

export default function MethodologyScreen() {
  const colors = useColors();
  return (
    <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Text style={[styles.eyebrow, { color: colors.primary }]}>RCA PLAYBOOK / 01</Text><Text style={[styles.title, { color: colors.foreground }]}>Методика расследования</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Пять шагов, чтобы перейти от симптома отказа к управляемой первопричине.</Text></View>
        <View style={[styles.principleCard, { backgroundColor: "#1E1E1E" }]}><View style={styles.principleMark}><MaterialIcons name="lightbulb" size={22} color="#F7B08E" /></View><View style={{ flex: 1 }}><Text style={styles.principleLabel}>КЛЮЧЕВОЙ ПРИНЦИП</Text><Text style={styles.principleText}>«Сломалась деталь» — это обычно только точка проявления. Ищите, почему система позволила отказу возникнуть и остаться незамеченным.</Text></View></View>
        <View style={styles.stepList}>{steps.map((step) => <View key={step.number} style={[styles.stepCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.stepNumber, { backgroundColor: step.number === "01" ? colors.primary : "#EAF0F2" }]}><Text style={[styles.stepNumberText, { color: step.number === "01" ? "#FFFFFF" : colors.foreground }]}>{step.number}</Text></View><View style={{ flex: 1 }}><View style={styles.stepTitleRow}><MaterialIcons name={step.icon as React.ComponentProps<typeof MaterialIcons>["name"]} size={19} color={colors.primary} /><Text style={[styles.stepTitle, { color: colors.foreground }]}>{step.title}</Text></View><Text style={[styles.stepText, { color: colors.muted }]}>{step.text}</Text></View></View>)}</View>
        <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Контроль качества вывода</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>Проверьте отчёт перед закрытием кейса</Text></View><MaterialIcons name="verified" size={22} color={colors.success} /></View>
        <View style={[styles.qualityCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>{qualityChecks.map(([label, text], index) => <View key={label} style={[styles.qualityRow, index < qualityChecks.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}><View style={[styles.qualityCheck, { backgroundColor: "#E5F5EF" }]}><MaterialIcons name="check" size={15} color="#16805D" /></View><View style={{ flex: 1 }}><Text style={[styles.qualityLabel, { color: colors.foreground }]}>{label}</Text><Text style={[styles.qualityText, { color: colors.muted }]}>{text}</Text></View></View>)}</View>
        <View style={[styles.footerNote, { borderColor: colors.border }]}><MaterialIcons name="info-outline" size={19} color={colors.primary} /><Text style={[styles.footerText, { color: colors.muted }]}>AI формирует рабочую гипотезу, а не подписывает заключение. Ответственный инженер подтверждает факты и принимает решение.</Text></View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 20 },
  header: { paddingTop: 8 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 6 },
  title: { fontSize: 27, fontWeight: "800", letterSpacing: -0.7 },
  subtitle: { fontSize: 13, lineHeight: 20, marginTop: 8, maxWidth: 340 },
  principleCard: { borderRadius: 20, padding: 17, flexDirection: "row", gap: 13 },
  principleMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#5B2E25", alignItems: "center", justifyContent: "center" },
  principleLabel: { color: "#F7B08E", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 5 },
  principleText: { color: "#FFFFFF", fontSize: 13, lineHeight: 20, fontWeight: "700" },
  stepList: { gap: 10 },
  stepCard: { borderWidth: 1, borderRadius: 17, padding: 14, flexDirection: "row", gap: 12 },
  stepNumber: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontSize: 11, fontWeight: "800" },
  stepTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepTitle: { fontSize: 14, fontWeight: "800" },
  stepText: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  sectionSubtitle: { fontSize: 12, marginTop: 3 },
  qualityCard: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 14 },
  qualityRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  qualityCheck: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  qualityLabel: { fontSize: 12, fontWeight: "800" },
  qualityText: { fontSize: 11, marginTop: 2 },
  footerNote: { borderWidth: 1, borderRadius: 15, padding: 13, flexDirection: "row", gap: 9, alignItems: "flex-start" },
  footerText: { flex: 1, fontSize: 11, lineHeight: 17 },
});
