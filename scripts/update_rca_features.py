from pathlib import Path
import re

index = Path('/home/ubuntu/pump-rca-mobile/app/(tabs)/index.tsx')
s = index.read_text()

old = '''  const updateCase = (next: PumpCase) => setCases((current) => current.map((item) => item.id === next.id ? next : item));
'''
new = '''  const updateCase = (next: PumpCase) => setCases((current) => current.map((item) => item.id === next.id ? next : item));

  const confirmDeleteCase = (item: PumpCase) => {
    Alert.alert("Удалить расследование?", "Вы уверены, что хотите удалить это расследование? Это действие нельзя отменить.", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => {
        const remaining = cases.filter((entry) => entry.id !== item.id);
        setCases(remaining);
        setSelectedId(remaining[0]?.id ?? "");
        setSearchQuery("");
        setActiveTag("Все");
        setActiveStatus("Все");
      } },
    ]);
  };
'''
assert old in s
s = s.replace(old, new, 1)

old_actions = '<View style={styles.detailActions}><ActionButton label="Добавить данные" icon="add-photo-alternate" onPress={() => openEvidenceEditor(selectedCase)} colors={colors} /><ActionButton label={isAnalyzing ? "Анализирую…" : "Запустить RCA"} icon={isAnalyzing ? "hourglass-top" : "auto-awesome"} onPress={() => analyzeCase(selectedCase)} colors={colors} primary={selectedCase.evidence.length > 0} disabled={isAnalyzing} /></View>'
new_actions = '<View style={styles.detailActions}><ActionButton label="Добавить данные" icon="add-photo-alternate" onPress={() => openEvidenceEditor(selectedCase)} colors={colors} /><ActionButton label={isAnalyzing ? "Анализирую…" : "Запустить RCA"} icon={isAnalyzing ? "hourglass-top" : "auto-awesome"} onPress={() => analyzeCase(selectedCase)} colors={colors} primary={selectedCase.evidence.length > 0} disabled={isAnalyzing} /><Pressable onPress={() => confirmDeleteCase(selectedCase)} style={({ pressed }) => [styles.deleteButton, { borderColor: colors.error, opacity: pressed ? 0.72 : 1 }]}><Icon name="delete-outline" size={18} color={colors.error} /><Text style={[styles.deleteButtonText, { color: colors.error }]}>Удалить</Text></Pressable></View>'
assert old_actions in s
s = s.replace(old_actions, new_actions, 1)

start = s.index('function RcaSummary(')
end = s.index('\n\nconst styles = StyleSheet.create', start)
replacement = '''function RcaSummary({ result, colors, onExport, isExporting, chatContext, onHistoryChange }: { result: RcaResult; colors: ReturnType<typeof useColors>; onExport: () => void; isExporting: boolean; chatContext: RcaChatContext; onHistoryChange: (history: RcaChatMessage[]) => void }) {
  const confidenceBand = getConfidenceBand(result.confidence);
  const confidenceLabel = confidenceBand === "high" ? "High" : confidenceBand === "medium" ? "Medium" : "Low";
  const blocks = [
    { number: "1", label: "Физическая причина", value: result.physicalCause },
    { number: "2", label: "Человеческий фактор", value: result.humanFactor },
    { number: "3", label: "Системная причина", value: result.systemicCause },
  ];
  return <View style={styles.resultStack}>
    <View style={[styles.rcaCard, { backgroundColor: "#1E1E1E" }]}>
      <View style={styles.rcaHeader}><View><Text style={styles.rcaEyebrow}>AI RCA / ВЫВОДЫ</Text><Text style={styles.rcaTitle}>Структурированный анализ</Text></View><View style={styles.confidence}><Text style={styles.confidenceNumber}>{result.confidence}%</Text><Text style={styles.confidenceLabel}>{confidenceLabel}</Text></View></View>
      <Text style={styles.rcaSummaryText}>{result.executiveSummary}</Text>
      {blocks.map((block) => <View key={block.number} style={styles.analysisBlock}><View style={styles.blockHeading}><View style={styles.blockNumber}><Text style={styles.blockNumberText}>{block.number}</Text></View><Text style={styles.blockTitle}>{block.label}</Text></View><Text style={styles.blockText}>{block.value}</Text></View>)}
      <View style={styles.analysisBlock}><View style={styles.blockHeading}><View style={styles.blockNumber}><Text style={styles.blockNumberText}>4</Text></View><Text style={styles.blockTitle}>Мероприятия по SMART</Text></View>{result.smartActions.map((action, index) => <View key={`${action.priority}-${index}`} style={styles.smartAction}><View style={styles.smartTop}><Text style={styles.recommendationBadgeText}>{action.priority}</Text><Text style={styles.smartActionTitle}>{action.specific}</Text></View><Text style={styles.smartLine}><Text style={styles.smartKey}>S</Text> {action.specific}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>M</Text> {action.measurable}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>A</Text> {action.achievable}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>R</Text> {action.relevant}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>T</Text> {action.timeBound}</Text></View>)}</View>
      <View style={styles.openQuestions}><Icon name="help-outline" size={19} color="#F7B08E" /><Text style={styles.openQuestionsText}>{result.openQuestions.length} открытых вопроса требуют проверки на месте</Text></View><Pressable disabled={isExporting} onPress={onExport} style={({ pressed }) => [styles.pdfButton, { opacity: isExporting ? 0.55 : pressed ? 0.8 : 1 }]}><Icon name={isExporting ? "hourglass-top" : "picture-as-pdf"} size={18} color="#FFFFFF" /><Text style={styles.pdfButtonText}>{isExporting ? "Формирую PDF…" : "Экспортировать RCA в PDF"}</Text></Pressable>
    </View><RcaChat key={chatContext.caseTitle} context={chatContext} onHistoryChange={onHistoryChange} />
  </View>;
}'''
s = s[:start] + replacement + s[end:]

s = s.replace('  pdfButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },\n  resultStack:', '  pdfButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },\n  deleteButton: { minHeight: 44, borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center" },\n  deleteButtonText: { fontSize: 11, fontWeight: "800" },\n  analysisBlock: { borderTopWidth: 1, borderTopColor: "#3A3A3A", paddingTop: 13, gap: 7 },\n  blockHeading: { flexDirection: "row", alignItems: "center", gap: 8 },\n  blockNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#F2673A", alignItems: "center", justifyContent: "center" },\n  blockNumberText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },\n  blockTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },\n  blockText: { color: "#F2F4F5", fontSize: 13, lineHeight: 20 },\n  smartAction: { backgroundColor: "#2A2A2A", borderRadius: 10, padding: 11, gap: 5 },\n  smartTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },\n  smartActionTitle: { color: "#FFFFFF", fontSize: 12, lineHeight: 17, fontWeight: "700", flex: 1 },\n  smartLine: { color: "#E5E7E9", fontSize: 11, lineHeight: 16 },\n  smartKey: { color: "#F7B08E", fontWeight: "800" },\n  resultStack:')
index.write_text(s)

# update tests' chat result shape
ptest = Path('/home/ubuntu/pump-rca-mobile/tests/rca.utils.test.ts')
t = ptest.read_text()
t = t.replace('''        eventChain: ["Запуск", "Рост вибрации"],
        immediateCause: "Перегрев",
        contributingFactors: ["Нет контроля"],
        rootCause: "Пробел в чек-листе",
        recommendations: [],''','''        physicalCause: "Перегрев",
        humanFactor: "Нет контроля",
        systemicCause: "Пробел в чек-листе",
        smartActions: [],''')
ptest.write_text(t)
