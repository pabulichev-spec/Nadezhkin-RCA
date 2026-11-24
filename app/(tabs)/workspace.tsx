import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { PumpRcaRepository } from "@/lib/domain-repository";
import { exportInvestigation, serializeArchive } from "@/lib/pumprca-transfer";
import { createCauseNode, createRcaTasks, getCompletion } from "@/shared/domain/rca-workspace";
import { buildRcaReportHtml } from "@/shared/report";
import type { CauseNode, Consequence, DomainState, Evidence, Investigation, Measurement, RcaTask, Symptom, TimelineEvent } from "@/shared/domain/types";
import { createTRPCClient } from "@/lib/trpc";

type Section = "Обзор" | "Событие отказа" | "Симптомы" | "Последствия" | "Хронология" | "Материалы" | "Измерения" | "Анализ" | "Гипотезы" | "Дерево причин" | "5 Why" | "16 RCA задач" | "Корневая причина" | "Мероприятия" | "До и после" | "Эффективность" | "Отчёт" | "Журнал";
const sections: Section[] = ["Обзор", "Событие отказа", "Симптомы", "Последствия", "Хронология", "Материалы", "Измерения", "Анализ", "Гипотезы", "Дерево причин", "5 Why", "16 RCA задач", "Корневая причина", "Мероприятия", "До и после", "Эффективность", "Отчёт", "Журнал"];
const inputStyle = { borderWidth: 1, borderRadius: 11, padding: 11, marginBottom: 9 } as const;

export default function WorkspaceScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id, section: requestedSection } = useLocalSearchParams<{ id?: string; section?: string }>();
  const repo = useMemo(() => new PumpRcaRepository(), []);
  const trpcClient = useMemo(() => createTRPCClient(), []);
  const [state, setState] = useState<DomainState>();
  const [investigation, setInvestigation] = useState<Investigation>();
  const initialSection = sections.includes(requestedSection as Section) ? requestedSection as Section : "Обзор";
  const [section, setSection] = useState<Section>(initialSection);
  const [draft, setDraft] = useState({ parameter: "", value: "", unit: "" });
  const [symptomText, setSymptomText] = useState("");
  const [consequenceText, setConsequenceText] = useState("");
  const [timelineText, setTimelineText] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [hypothesisText, setHypothesisText] = useState("");
  const [causeText, setCauseText] = useState("");
  const [causeDescription, setCauseDescription] = useState("");
  const [causeType, setCauseType] = useState<CauseNode["type"]>("PHYSICAL_CAUSE");
  const [causeParentId, setCauseParentId] = useState<string | undefined>();
  const [fiveWhyDrafts, setFiveWhyDrafts] = useState<string[]>(["", "", "", "", ""]);
  const [rootCauseText, setRootCauseText] = useState("");
  const [actionText, setActionText] = useState("");
  const [owner, setOwner] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [failureText, setFailureText] = useState("");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = async () => {
    const next = await repo.getState();
    let current = next.investigations.find((item) => item.id === id || item.legacyCaseId === id) ?? next.investigations[0];
    if (current) {
      const existingTasks = next.tasks.filter((task) => task.investigationId === current!.id);
      if (existingTasks.length < 16) {
        const missing = createRcaTasks(current.id).filter((task) => !existingTasks.some((old) => old.number === task.number));
        for (const task of missing) await repo.saveTask(task);
        current = { ...current, taskIds: [...existingTasks, ...missing].map((task) => task.id) };
        await repo.replaceInvestigation(current);
        next.tasks.push(...missing);
        next.investigations = next.investigations.map((item) => item.id === current!.id ? current! : item);
      }
      setInvestigation(current);
      setFailureText(current.failureEvent?.description ?? "");
      setRootCauseText(current.rootCause?.statement ?? "");
      setFiveWhyDrafts(Array.from({ length: 5 }, (_, index) => current.fiveWhys?.find((item) => item.level === index + 1)?.answer ?? ""));
    }
    setState(next);
  };
  // Refresh is intentionally scoped to the selected investigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh().catch(() => undefined); }, [id]);

  if (!state || !investigation) return <ScreenContainer className="p-5"><Text style={{ color: colors.foreground }}>Загрузка рабочего пространства…</Text></ScreenContainer>;
  const current = investigation;
  const idFor = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tasks = state.tasks.filter((item) => item.investigationId === current.id).sort((a, b) => a.number - b.number);
  const measurements = state.measurements.filter((item) => item.investigationId === current.id);
  const symptoms = state.symptoms.filter((item) => item.investigationId === current.id);
  const consequences = state.consequences.filter((item) => item.investigationId === current.id);
  const timeline = state.timeline.filter((item) => item.investigationId === current.id);
  const evidence = state.evidence.filter((item) => item.investigationId === current.id);
  const hypotheses = state.hypotheses.filter((item) => item.investigationId === current.id);
  const causes = state.causes.filter((item) => item.investigationId === current.id);
  const actions = state.actions.filter((item) => item.investigationId === current.id);
  const completion = getCompletion(state, current);

  const saveInvestigation = async (next: Investigation) => { await repo.replaceInvestigation({ ...next, updatedAt: new Date().toISOString() }); await refresh(); };
  const saveEntity = async (kind: "measurement" | "symptom" | "consequence" | "timeline" | "evidence" | "hypothesis" | "cause" | "task" | "action", value: Measurement | Symptom | Consequence | TimelineEvent | typeof evidence[number] | typeof hypotheses[number] | CauseNode | RcaTask | typeof actions[number]) => {
    const methods = {
      measurement: (item: never) => repo.saveMeasurement(item), symptom: (item: never) => repo.saveSymptom(item), consequence: (item: never) => repo.saveConsequence(item),
      timeline: (item: never) => repo.saveTimelineEvent(item), evidence: (item: never) => repo.saveEvidence(item), hypothesis: (item: never) => repo.saveHypothesis(item),
      cause: (item: never) => repo.saveCause(item), task: (item: never) => repo.saveTask(item), action: (item: never) => repo.saveAction(item),
    } as const;
    await methods[kind](value as never); await refresh();
  };
  const removeEntity = async (collection: keyof Pick<DomainState, "measurements" | "symptoms" | "consequences" | "timeline" | "evidence" | "hypotheses" | "causes" | "tasks" | "actions">, entityId: string) => { const next = await repo.getState(); next[collection] = next[collection].filter((item) => item.id !== entityId) as never; await repo.save(next); await refresh(); };
  const addMeasurement = async () => { if (!draft.parameter.trim()) throw new Error("Укажите параметр измерения."); if (draft.value && Number.isNaN(Number(draft.value))) throw new Error("Значение измерения должно быть числом."); await saveEntity("measurement", { id: idFor("measurement"), investigationId: current.id, parameter: draft.parameter.trim(), value: draft.value ? Number(draft.value) : null, unit: draft.unit.trim(), measuredAt: new Date().toISOString(), evidenceIds: [] }); setDraft({ parameter: "", value: "", unit: "" }); };
  const addSymptom = async () => { if (!symptomText.trim()) throw new Error("Введите симптом или наблюдение."); await saveEntity("symptom", { id: idFor("symptom"), investigationId: current.id, title: symptomText.trim(), description: symptomText.trim(), observedAt: new Date().toISOString(), source: "Инженерное наблюдение" }); setSymptomText(""); };
  const addConsequence = async () => { if (!consequenceText.trim()) throw new Error("Введите последствие отказа."); await saveEntity("consequence", { id: idFor("consequence"), investigationId: current.id, type: "OTHER", description: consequenceText.trim() }); setConsequenceText(""); };
  const addTimeline = async () => { if (!timelineText.trim()) throw new Error("Введите событие хронологии."); await saveEntity("timeline", { id: idFor("timeline"), investigationId: current.id, stage: "Событие", occurredAt: new Date().toISOString(), description: timelineText.trim(), source: "Инженерная запись" }); setTimelineText(""); };
  const addEvidence = async () => { if (!evidenceText.trim()) throw new Error("Введите текст доказательства."); const item = { id: idFor("evidence"), investigationId: current.id, kind: "note" as const, name: "Заметка рабочей области", note: evidenceText.trim(), createdAt: new Date().toISOString(), linkedHypothesisIds: [], linkedCauseNodeIds: [], linkedTaskIds: [] }; await saveEntity("evidence", item); await saveInvestigation({ ...current, evidenceIds: [...new Set([...current.evidenceIds, item.id])] }); setSelectedEvidenceId(item.id); setEvidenceText(""); };
  const addHypothesis = async () => { if (!hypothesisText.trim()) throw new Error("Введите проверяемую гипотезу."); await saveEntity("hypothesis", { id: idFor("hypothesis"), investigationId: current.id, title: hypothesisText.trim(), status: "NEW", supportingEvidenceIds: [], contradictingEvidenceIds: [], requiredChecks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); setHypothesisText(""); };
  const addCause = async () => { if (!causeText.trim()) throw new Error("Введите название блока причины."); await saveEntity("cause", createCauseNode(current.id, { type: causeType, title: causeText.trim(), description: causeDescription.trim() || undefined, parentId: causeParentId, sortOrder: causes.length, evidenceIds: [] })); setCauseText(""); setCauseDescription(""); setCauseParentId(undefined); };
  const saveFiveWhys = async () => {
    const existing = current.fiveWhys ?? [];
    const fiveWhys = fiveWhyDrafts.map((answer, index) => {
      const old = existing.find((item) => item.level === index + 1);
      return { id: old?.id ?? idFor("why"), level: index + 1, why: `Почему произошло отклонение — шаг ${index + 1}?`, answer: answer.trim(), evidenceIds: old?.evidenceIds ?? [], comment: old?.comment };
    }).filter((item) => item.answer);
    await saveInvestigation({ ...current, fiveWhys });
  };
  const addAction = async () => { if (!actionText.trim()) throw new Error("Введите SMART-мероприятие."); await saveEntity("action", { id: idFor("action"), investigationId: current.id, description: actionText.trim(), owner: owner.trim() || undefined, dueAt: dueAt.trim() || undefined, status: "PLANNED", causeNodeIds: [], measurementIds: [], specific: actionText.trim(), measurable: undefined, achievable: undefined, relevant: undefined, timeBound: dueAt.trim() || undefined, priority: undefined }); setActionText(""); setOwner(""); setDueAt(""); };
  const toggleTask = async (task: RcaTask) => saveEntity("task", { ...task, status: task.status === "DONE" ? "TODO" : "DONE", updatedAt: new Date().toISOString() });
  const saveFailure = async () => { if (!failureText.trim()) throw new Error("Опишите событие отказа перед сохранением."); await saveInvestigation({ ...current, failureEvent: { ...(current.failureEvent ?? {}), description: failureText.trim(), occurredAt: new Date().toISOString() } }); };
  const saveRootCause = async () => { if (!rootCauseText.trim()) throw new Error("Введите корневую причину перед подтверждением."); await saveInvestigation({ ...current, rootCause: { statement: rootCauseText.trim(), type: "Technical", evidenceIds: [], hypothesisIds: hypotheses.map((item) => item.id) } }); };
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const file = result.assets[0];
      const kind = file.mimeType?.startsWith("image/") ? "photo" : file.mimeType?.startsWith("video/") ? "video" : "file";
      const item: Evidence = { id: idFor("evidence"), investigationId: current.id, kind, name: file.name, uri: file.uri, mimeType: file.mimeType, createdAt: new Date().toISOString(), linkedHypothesisIds: [], linkedCauseNodeIds: [], linkedTaskIds: [] };
      await repo.saveEvidence(item);
      await saveInvestigation({ ...current, evidenceIds: [...new Set([...current.evidenceIds, item.id])] });
      setSelectedEvidenceId(item.id);
      Alert.alert("Доказательство прикреплено", `${item.name}\nТип: ${item.mimeType ?? "не определён"}`);
    } catch (error) {
      Alert.alert("Файл не прикреплён", error instanceof Error ? error.message : "Не удалось выбрать документ.");
    }
  };
  const removeSelectedEvidence = async () => {
    const item = evidence.find((entry) => entry.id === selectedEvidenceId);
    if (!item) return Alert.alert("Файл не выбран", "Выберите доказательство в списке.");
    Alert.alert("Удалить доказательство?", `Файл «${item.name}» будет удалён из текущего расследования.`, [{ text: "Отмена", style: "cancel" }, { text: "Удалить", style: "destructive", onPress: async () => { try { await repo.deleteEvidence(item.id, current.id); setSelectedEvidenceId(null); await refresh(); Alert.alert("Удалено", "Доказательство удалено из расследования. Исходный файл не удаляется глобально."); } catch (error) { Alert.alert("Удаление не выполнено", error instanceof Error ? error.message : "Сервер или хранилище не подтвердили удаление."); } } }]);
  };
  const downloadText = (filename: string, text: string, mime: string) => { if (Platform.OS === "web") { const blob = new Blob([text], { type: mime }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); } };
  const exportPumprca = async () => { const archive = serializeArchive(exportInvestigation(state, current.id)); if (Platform.OS === "web") downloadText(`${current.title.replace(/[^a-z0-9а-яё]+/gi, "-")}.pumprca`, archive, "application/json"); else { const uri = `${FileSystem.cacheDirectory}${current.id}.pumprca`; await FileSystem.writeAsStringAsync(uri, archive); if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json" }); } };
  const exportPdf = async () => { const legacy = (current.legacyData ?? {}) as Record<string, unknown>; const result = legacy.result as Parameters<typeof buildRcaReportHtml>[0]["result"]; if (!result) return Alert.alert("Сначала сформируйте RCA", "PDF-отчёт доступен после серверного анализа причин на главном экране."); const html = buildRcaReportHtml({ title: current.title, equipmentType: state.pumps.find((item) => item.id === current.pumpId)?.equipmentType ?? "—", assetTag: state.pumps.find((item) => item.id === current.pumpId)?.assetTag ?? "—", location: state.pumps.find((item) => item.id === current.pumpId)?.location ?? "—", severity: current.severity ?? "—", narrative: current.narrative, tags: current.tags, evidence: evidence.map((item) => ({ id: item.id, kind: item.kind, name: item.name, note: item.note, annotations: (item as typeof item & { annotations?: unknown }).annotations as never, imageData: (item as typeof item & { imageData?: string }).imageData, mediaHash: item.mediaHash })), result, workspace: { failureEvent: current.failureEvent, timeline, measurements, hypotheses, tasks, causeNodes: causes, fiveWhys: current.fiveWhys, rootCause: current.rootCause, actions, effectiveness: current.effectiveness } }, new Date().toLocaleString("ru-RU")); await Print.printAsync({ html }); await saveInvestigation({ ...current, report: { generatedAt: new Date().toISOString(), format: "PDF" } }); };
  const downloadEvidence = async (item: Evidence) => {
    try {
      let source = item.uri;
      if (!source) {
        const signed = await trpcClient.investigation.signedEvidenceUrl.query({ evidenceId: item.id });
        source = signed.url;
      }
      if (!source) throw new Error("Файл недоступен");
      if (Platform.OS === "web") {
        const anchor = document.createElement("a");
        anchor.href = source;
        anchor.download = item.name;
        anchor.click();
        Alert.alert("Скачивание начато", `Файл «${item.name}» передан браузеру.`);
        return;
      }
      if (source.startsWith("file://") || source.startsWith("content://")) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(source, { dialogTitle: `Скачать ${item.name}` });
          Alert.alert("Файл готов", `«${item.name}» передан системному меню сохранения Android.`);
        } else Alert.alert("Сохранение недоступно", "На устройстве нет доступного системного механизма сохранения файла.");
        return;
      }
      const safeName = item.name.replace(/[^\p{L}\p{N}._-]+/gu, "-") || `доказательство-${item.id}`;
      const target = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}${safeName}`;
      const downloaded = await FileSystem.downloadAsync(source, target);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloaded.uri, { dialogTitle: `Скачать ${item.name}` });
        Alert.alert("Файл готов", `«${item.name}» передан системному меню сохранения Android.`);
      } else Alert.alert("Сохранение недоступно", `Файл подготовлен в локальном хранилище приложения: ${downloaded.uri}`);
    } catch {
      Alert.alert("Файл недоступен", "Не удалось скачать доказательство. Проверьте авторизацию, права доступа и наличие файла.");
    }
  };

  const field = (value: string, onChangeText: (value: string) => void, placeholder: string, multiline = false) => <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} multiline={multiline} returnKeyType={multiline ? "default" : "done"} style={[multiline ? styles.textarea : styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />;
  const addButton = (label: string, onPress: () => void | Promise<void>) => <Pressable disabled={isSaving} onPress={() => { Promise.resolve(onPress()).catch((error) => Alert.alert("Операция не выполнена", error instanceof Error ? error.message : "Не удалось выполнить действие.")); }} style={[styles.primary, { backgroundColor: colors.primary, opacity: isSaving ? 0.65 : 1 }]}><Text style={styles.primaryText}>{label}</Text></Pressable>;
  const saveButton = (label: string, onPress: () => void | Promise<void>) => <Pressable disabled={isSaving} onPress={async () => { setIsSaving(true); try { await onPress(); Alert.alert("Сохранено", "Данные расследования записаны и будут доступны после повторного открытия кейса."); } catch (error) { Alert.alert("Сохранение не выполнено", error instanceof Error ? error.message : "Не удалось записать данные."); } finally { setIsSaving(false); } }} style={[styles.primary, { backgroundColor: colors.primary, opacity: isSaving ? 0.65 : 1 }]}><Text style={styles.primaryText}>{isSaving ? "Сохранение…" : label}</Text></Pressable>;
  const listRow = (text: string, onDelete?: () => void) => <View style={[styles.row, { borderBottomColor: colors.border }]}><Text style={{ color: colors.foreground, flex: 1 }}>{text}</Text>{onDelete && <Pressable onPress={onDelete}><Text style={{ color: colors.error, fontWeight: "800" }}>Удалить</Text></Pressable>}</View>;
  const causeTypes: { value: CauseNode["type"]; label: string }[] = [
    { value: "HYPOTHESIS_UNCONFIRMED", label: "Гипотеза неподтверждена" },
    { value: "HYPOTHESIS_CONFIRMED", label: "Гипотеза подтверждена" },
    { value: "HUMAN_FACTOR", label: "Человеческий фактор" },
    { value: "PHYSICAL_CAUSE", label: "Физическая причина" },
    { value: "SYSTEMIC_CAUSE", label: "Системная причина" },
  ];
  const causeTypeLabel = (type: CauseNode["type"]) => causeTypes.find((item) => item.value === type)?.label ?? type;
  const renderCauseTree = (parentId?: string, depth = 0): React.ReactNode => causes.filter((item) => item.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => <View key={item.id} style={[styles.causeNode, { marginLeft: Math.min(depth, 4) * 14, borderColor: colors.border, backgroundColor: depth === 0 ? colors.background : colors.surface }]}><View style={styles.causeNodeHeader}><View style={[styles.causeTypeBadge, { backgroundColor: colors.primary }]}><Text style={styles.causeTypeBadgeText}>{causeTypeLabel(item.type)}</Text></View><Pressable onPress={() => removeEntity("causes", item.id)}><Text style={{ color: colors.error, fontWeight: "800" }}>Удалить</Text></Pressable></View><Text style={[styles.causeNodeTitle, { color: colors.foreground }]}>{item.title}</Text>{item.description ? <Text style={{ color: colors.muted, marginTop: 4 }}>{item.description}</Text> : null}{renderCauseTree(item.id, depth + 1)}</View>);

  return <ScreenContainer className="p-4"><ScrollView showsVerticalScrollIndicator={false}><View style={[styles.header, { borderBottomColor: colors.border }]}><View style={styles.headerTop}><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={{ color: colors.primary, fontWeight: "800" }}>← Назад</Text></Pressable><View style={[styles.statusPill, { backgroundColor: current.status === "CLOSED" || current.status === "APPROVED" ? "#173F35" : "#263B58" }]}><View style={[styles.statusDot, { backgroundColor: current.status === "CLOSED" || current.status === "APPROVED" ? "#37D98B" : colors.primary }]} /><Text style={{ color: "#D9E8FF", fontWeight: "800", fontSize: 11 }}>{current.status === "CLOSED" ? "Закрыт" : "Активный"}</Text></View></View><Text style={[styles.title, { color: colors.foreground }]}>{current.title}</Text><Text style={{ color: colors.muted, marginTop: 3 }}>{state?.pumps.find((pump) => pump.id === current.pumpId)?.assetTag ?? "Насосное оборудование"} · {current.severity ?? "Обычный приоритет"}</Text><View style={styles.heroStats}><Text style={{ color: colors.muted, fontSize: 11 }}>Материалы <Text style={{ color: colors.foreground, fontWeight: "900" }}>{evidence.length}</Text></Text><Text style={{ color: colors.muted, fontSize: 11 }}>Готовность <Text style={{ color: colors.primary, fontWeight: "900" }}>{completion.percent}%</Text></Text><Text style={{ color: colors.muted, fontSize: 11 }}>Обновлено <Text style={{ color: colors.foreground, fontWeight: "900" }}>{new Date(current.updatedAt).toLocaleDateString("ru-RU")}</Text></Text></View></View><View style={[styles.primaryTabRow, { backgroundColor: colors.background, borderColor: colors.border }]}>{[{ label: "Обзор", target: "Обзор" as Section }, { label: "Доказательства", target: "Материалы" as Section }, { label: "RCA", target: "Анализ" as Section }].map((item) => <Pressable key={item.label} onPress={() => setSection(item.target)} style={[styles.primaryTab, { backgroundColor: section === item.target || (item.label === "RCA" && ["Анализ", "Гипотезы", "Дерево причин", "5 Why", "Корневая причина", "Мероприятия", "До и после", "Эффективность"].includes(section)) ? colors.primary : colors.surface }]}><Text style={{ color: section === item.target || (item.label === "RCA" && ["Анализ", "Гипотезы", "Дерево причин", "5 Why", "Корневая причина", "Мероприятия", "До и после", "Эффективность"].includes(section)) ? "#fff" : colors.foreground, fontWeight: "800", fontSize: 12 }}>{item.label}</Text></Pressable>)}</View><Text style={[styles.detailSectionsLabel, { color: colors.muted }]}>РАЗДЕЛЫ РАССЛЕДОВАНИЯ</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>{sections.map((item) => <Pressable key={item} onPress={() => setSection(item)} style={[styles.tab, { backgroundColor: section === item ? colors.primary : colors.surface, borderColor: colors.border }]}><Text style={{ color: section === item ? "#fff" : colors.foreground, fontWeight: "700" }}>{item}</Text></Pressable>)}</ScrollView><View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kicker, { color: colors.primary }]}>{section.toUpperCase()}</Text>
    {section === "Обзор" && <><Text style={[styles.h2, { color: colors.foreground }]}>Рабочая область расследования</Text><Text style={{ color: colors.muted }}>{current.narrative || "Описание не заполнено."}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: `${completion.percent}%`, backgroundColor: colors.primary }]} /></View><Text style={{ color: colors.foreground, fontWeight: "800" }}>Проверки: {Object.entries(completion.checks).filter(([, value]) => value).length}/{completion.total}</Text><Text style={{ color: colors.muted, marginTop: 8 }}>Материалы: {evidence.length} · Измерения {measurements.length} · Гипотезы {hypotheses.length} · Задачи: {tasks.filter((item) => item.status === "DONE").length}/{tasks.length}</Text><View style={styles.rowWrap}>{addButton("Экспорт .pumprca", () => { exportPumprca().catch((error) => Alert.alert("Экспорт не выполнен", String(error))); })}{addButton("Сформировать PDF", () => { exportPdf().catch((error) => Alert.alert("PDF не сформирован", String(error))); })}</View></>}
    {section === "Событие отказа" && <>{field(failureText, setFailureText, "Опишите отказ, режим работы и последствия", true)}{saveButton("Сохранить событие отказа", saveFailure)}</>}
    {section === "Симптомы" && <>{field(symptomText, setSymptomText, "Добавить симптом или наблюдение")}{saveButton("Добавить симптом", addSymptom)}{symptoms.map((item) => listRow(`${item.title} · ${item.source ?? ""}`, () => removeEntity("symptoms", item.id)))}</>}
    {section === "Последствия" && <>{field(consequenceText, setConsequenceText, "Добавить последствие отказа")}{saveButton("Добавить последствие", addConsequence)}{consequences.map((item) => listRow(`${item.type}: ${item.description}`, () => removeEntity("consequences", item.id)))}</>}
    {section === "Хронология" && <>{field(timelineText, setTimelineText, "Добавить событие timeline")}{saveButton("Добавить событие", addTimeline)}{timeline.map((item) => listRow(`${item.occurredAt ?? "Дата не указана"} · ${item.description}`, () => removeEntity("timeline", item.id)))}</>}
    {section === "Материалы" && <><Text style={[styles.h2, { color: colors.foreground }]}>Доказательства</Text><Text style={{ color: colors.muted, marginBottom: 10 }}>Фото, видео и документы, связанные с этим кейсом.</Text><View style={styles.evidenceGrid}>{evidence.slice(0, 6).map((item) => <Pressable key={`tile-${item.id}`} onPress={() => setSelectedEvidenceId(item.id)} style={[styles.evidenceTile, { borderColor: selectedEvidenceId === item.id ? colors.primary : colors.border, backgroundColor: colors.background }]}>{item.uri && (item.kind === "photo" || item.kind === "video") ? <Image source={{ uri: item.uri }} contentFit="cover" style={styles.evidenceThumb} /> : <View style={styles.evidenceThumbFallback}><Text style={{ color: colors.primary, fontWeight: "900", fontSize: 10 }}>{item.kind === "video" ? "ВИДЕО" : item.kind === "file" ? "ФАЙЛ" : "ЗАМЕТКА"}</Text></View>}<Text numberOfLines={1} style={[styles.evidenceTileName, { color: colors.foreground }]}>{item.name}</Text></Pressable>)}{evidence.length < 6 ? <Pressable onPress={pickDocument} style={[styles.evidenceTile, styles.addTile, { borderColor: colors.border, backgroundColor: colors.background }]}><Text style={{ color: colors.primary, fontSize: 26 }}>＋</Text><Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800" }}>Добавить</Text></Pressable> : null}</View><View style={styles.rowWrap}>{addButton("Выбрать документ", pickDocument)}{addButton("Скачать выбранное", () => { const item = evidence.find((entry) => entry.id === selectedEvidenceId); if (!item) return Alert.alert("Файл не выбран", "Выберите доказательство в списке."); downloadEvidence(item).catch(() => undefined); })}{addButton("Удалить выбранное", removeSelectedEvidence)}</View>{field(evidenceText, setEvidenceText, "Добавить текстовую заметку о факте", true)}{addButton("Добавить заметку", addEvidence)}{evidence.map((item) => <Pressable key={item.id} onPress={() => setSelectedEvidenceId(item.id)} style={[styles.evidenceItem, { backgroundColor: selectedEvidenceId === item.id ? colors.background : "transparent", borderColor: selectedEvidenceId === item.id ? colors.primary : colors.border }]}><View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontWeight: "800" }}>{item.name}</Text><Text style={{ color: colors.muted, marginTop: 3 }}>Тип: {item.mimeType ?? item.kind} · {item.note || "Описание не указано"}</Text></View>{selectedEvidenceId === item.id && <Text style={{ color: colors.primary, fontWeight: "800" }}>Выбрано</Text>}</Pressable>)}</>}
    {section === "Измерения" && <><View style={styles.measureRow}><TextInput value={draft.parameter} onChangeText={(value) => setDraft({ ...draft, parameter: value })} placeholder="Параметр" placeholderTextColor={colors.muted} returnKeyType="next" style={[styles.smallInput, { color: colors.foreground, borderColor: colors.border }]} /><TextInput value={draft.value} onChangeText={(value) => setDraft({ ...draft, value })} placeholder="Значение" placeholderTextColor={colors.muted} keyboardType="numeric" returnKeyType="next" style={[styles.smallInput, { color: colors.foreground, borderColor: colors.border }]} /><TextInput value={draft.unit} onChangeText={(value) => setDraft({ ...draft, unit: value })} placeholder="Ед." placeholderTextColor={colors.muted} returnKeyType="done" style={[styles.smallInput, { color: colors.foreground, borderColor: colors.border }]} /></View>{saveButton("Добавить измерение", addMeasurement)}{measurements.map((item) => listRow(`${item.parameter}: ${item.value ?? "—"} ${item.unit}`, () => removeEntity("measurements", item.id)))}</>}
    {(section === "Анализ" || section === "Гипотезы") && <><Text style={{ color: colors.muted, marginBottom: 10 }}>Гипотезы связываются с материалами и используются при подтверждении корневой причины.</Text>{field(hypothesisText, setHypothesisText, "Проверяемая гипотеза")}{saveButton("Добавить гипотезу", addHypothesis)}{hypotheses.map((item) => listRow(`${item.title} · ${item.status}`, () => removeEntity("hypotheses", item.id)))}</>}
    {section === "Дерево причин" && <><Text style={{ color: colors.muted, marginBottom: 10 }}>Стройте цепочку сверху вниз: каждый новый блок можно привязать к родительской причине. Описание и категория сохраняются в расследовании.</Text>{field(causeText, setCauseText, "Название блока причины")}{field(causeDescription, setCauseDescription, "Описание и проверяемые признаки", true)}<Text style={[styles.fieldLabel, { color: colors.foreground }]}>Категория блока</Text><View style={styles.choiceWrap}>{causeTypes.map((item) => <Pressable key={item.value} onPress={() => setCauseType(item.value)} style={[styles.choice, { borderColor: causeType === item.value ? colors.primary : colors.border, backgroundColor: causeType === item.value ? colors.primary : colors.background }]}><Text style={{ color: causeType === item.value ? "#fff" : colors.foreground, fontWeight: "700", fontSize: 11 }}>{item.label}</Text></Pressable>)}</View><Text style={[styles.fieldLabel, { color: colors.foreground }]}>Родительский блок</Text><View style={styles.choiceWrap}><Pressable onPress={() => setCauseParentId(undefined)} style={[styles.choice, { borderColor: !causeParentId ? colors.primary : colors.border, backgroundColor: !causeParentId ? colors.primary : colors.background }]}><Text style={{ color: !causeParentId ? "#fff" : colors.foreground, fontWeight: "700", fontSize: 11 }}>Верхний уровень</Text></Pressable>{causes.map((item) => <Pressable key={item.id} onPress={() => setCauseParentId(item.id)} style={[styles.choice, { borderColor: causeParentId === item.id ? colors.primary : colors.border, backgroundColor: causeParentId === item.id ? colors.primary : colors.background }]}><Text numberOfLines={1} style={{ color: causeParentId === item.id ? "#fff" : colors.foreground, fontWeight: "700", fontSize: 11 }}>{item.title}</Text></Pressable>)}</View>{saveButton("Добавить блок в дерево", addCause)}<Text style={[styles.h2, { color: colors.foreground }]}>Дерево причин</Text>{causes.length ? renderCauseTree() : <Text style={{ color: colors.muted }}>Пока нет блоков. Добавьте верхнюю причину или гипотезу.</Text>}</>}
    {section === "5 Why" && <><Text style={{ color: colors.muted, marginBottom: 10 }}>Заполните пять последовательных уровней: от непосредственного события к системной причине.</Text>{fiveWhyDrafts.map((answer, index) => <View key={index} style={[styles.whyBlock, { borderColor: colors.border, backgroundColor: colors.background }]}><Text style={[styles.whyNumber, { color: colors.primary }]}>ПОЧЕМУ {index + 1}</Text><Text style={[styles.whyQuestion, { color: colors.foreground }]}>Почему произошёл отказ на этом уровне?</Text><TextInput value={answer} onChangeText={(value) => setFiveWhyDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder="Введите ответ и подтверждающие факты" placeholderTextColor={colors.muted} multiline style={[styles.textarea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />{current.fiveWhys?.find((item) => item.level === index + 1)?.evidenceIds.length ? <Text style={{ color: colors.muted, fontSize: 11 }}>Связанные доказательства сохранены</Text> : null}</View>)}{saveButton("Сохранить 5 Why", saveFiveWhys)}</>}
    {section === "16 RCA задач" && <>{tasks.map((task) => <Pressable key={task.id} onPress={() => toggleTask(task)} style={[styles.task, { borderBottomColor: colors.border }]}><Text style={{ color: colors.foreground, flex: 1 }}>{task.number}. {task.title}</Text><Text style={{ color: task.status === "DONE" ? colors.success : colors.primary, fontWeight: "800" }}>{task.status}</Text></Pressable>)}</>}
    {section === "Корневая причина" && <>{field(rootCauseText, setRootCauseText, "Подтверждённая корневая причина", true)}{saveButton("Подтвердить корневую причину", saveRootCause)}{current.rootCause && <Text style={{ color: colors.success, marginTop: 8 }}>Подтверждено: {current.rootCause.confirmedBy}</Text>}</>}
    {(section === "Мероприятия" || section === "До и после" || section === "Эффективность") && <><Text style={{ color: colors.muted }}>SMART: конкретное действие, KPI, ответственный, срок и проверка эффекта.</Text>{field(actionText, setActionText, "SMART мероприятие")}{field(owner, setOwner, "Ответственный")}{field(dueAt, setDueAt, "Срок")}{saveButton("Сохранить мероприятие", addAction)}{actions.map((item) => listRow(`${item.description} · ${item.owner ?? "нет владельца"} · ${item.status}`, () => removeEntity("actions", item.id)))}</>}
    {section === "Отчёт" && <><Text style={{ color: colors.muted }}>Полный PDF включает материалы, измерения, гипотезы, дерево причин, «5 почему», корневую причину, SMART и проверку эффективности.</Text>{addButton("Открыть / сформировать PDF", () => { exportPdf().catch((error) => Alert.alert("PDF не сформирован", String(error))); })}</>}
    {section === "Журнал" && <><Text style={{ color: colors.muted }}>Аудит workflow хранится в repository.</Text>{state.auditLog.filter((item) => item.investigationId === current.id).map((item) => listRow(`${item.timestamp} · ${item.action}${item.comment ? ` · ${item.comment}` : ""}`))}</>}
  </View></ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create({ header: { marginBottom: 15, paddingBottom: 12, borderBottomWidth: 1 }, headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, backButton: { paddingVertical: 4 }, statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }, statusDot: { width: 7, height: 7, borderRadius: 4 }, heroStats: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 }, primaryTabRow: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4, gap: 4, marginBottom: 9 }, primaryTab: { flex: 1, minHeight: 37, borderRadius: 10, alignItems: "center", justifyContent: "center" }, detailSectionsLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 7 }, evidenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 12 }, evidenceTile: { width: "31%", minHeight: 91, borderWidth: 1, borderRadius: 12, overflow: "hidden" }, evidenceThumb: { width: "100%", height: 58 }, evidenceThumbFallback: { width: "100%", height: 58, alignItems: "center", justifyContent: "center", backgroundColor: "#101B2B" }, evidenceTileName: { fontSize: 9, fontWeight: "800", paddingHorizontal: 6, paddingVertical: 7 }, addTile: { alignItems: "center", justifyContent: "center" }, title: { fontSize: 25, fontWeight: "900", marginTop: 12 }, tab: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderRadius: 20, marginRight: 7 }, card: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 22 }, kicker: { fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 12 }, h2: { fontSize: 20, fontWeight: "800", marginBottom: 8 }, input: { ...inputStyle }, textarea: { ...inputStyle, minHeight: 100, textAlignVertical: "top" }, fieldLabel: { fontSize: 12, fontWeight: "800", marginTop: 4, marginBottom: 7 }, measureRow: { flexDirection: "row", gap: 6, marginBottom: 9 }, rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }, choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 }, choice: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, maxWidth: "100%" }, smallInput: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 }, primary: { borderRadius: 12, padding: 13, alignItems: "center", marginBottom: 10 }, primaryText: { color: "#fff", fontWeight: "800" }, task: { flexDirection: "row", paddingVertical: 13, borderBottomWidth: 1 }, progress: { height: 9, borderRadius: 5, backgroundColor: "#CBD5E1", overflow: "hidden", marginVertical: 14 }, progressFill: { height: "100%" }, row: { flexDirection: "row", gap: 8, paddingVertical: 11, borderBottomWidth: 1 }, causeNode: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 9 }, causeNodeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }, causeTypeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, alignSelf: "flex-start", maxWidth: "82%" }, causeTypeBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" }, causeNodeTitle: { fontSize: 15, fontWeight: "800", lineHeight: 20 }, whyBlock: { borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 10 }, whyNumber: { fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 5 }, whyQuestion: { fontSize: 14, fontWeight: "800", marginBottom: 8 }, evidenceActions: { gap: 10, alignItems: "flex-end", justifyContent: "center" }, evidenceItem: { flexDirection: "row", gap: 8, alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 } });
