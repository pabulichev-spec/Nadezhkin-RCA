import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { getConfidenceBand } from "@/shared/rca";

const STORAGE_KEY = "pumprca.cases.v1";

type EvidenceKind = "photo" | "video" | "text" | "file";
type Severity = "Критический" | "Высокий" | "Средний";

type Evidence = {
  id: string;
  kind: EvidenceKind;
  name: string;
  uri?: string;
  mimeType?: string;
  note?: string;
  createdAt: string;
};

type RcaResult = {
  executiveSummary: string;
  eventChain: string[];
  immediateCause: string;
  contributingFactors: string[];
  rootCause: string;
  recommendations: { priority: string; action: string; owner: string; horizon: string }[];
  confidence: number;
  openQuestions: string[];
  methodNotes: string;
};

type PumpCase = {
  id: string;
  title: string;
  equipmentType: string;
  assetTag: string;
  location: string;
  severity: Severity;
  status: "В работе" | "Готово";
  narrative: string;
  evidence: Evidence[];
  result?: RcaResult;
  updatedAt: string;
};

const demoCases: PumpCase[] = [
  {
    id: "demo-1",
    title: "Вибрация на насосе P-204",
    equipmentType: "Центробежный насос",
    assetTag: "P-204 / 4A",
    location: "Участок водооборота",
    severity: "Высокий",
    status: "Готово",
    narrative: "После запуска резервного агрегата выросла вибрация на подшипниковом узле. Через 40 минут оператор остановил насос.",
    evidence: [
      { id: "e-1", kind: "photo", name: "подшипник_01.jpg", note: "Следы перегрева на наружном кольце", createdAt: "2026-09-22" },
      { id: "e-2", kind: "text", name: "Журнал смены", note: "Вибрация 8.4 мм/с, рост за 3 часа", createdAt: "2026-09-22" },
    ],
    result: {
      executiveSummary: "Наиболее вероятна комбинация разцентровки после смены агрегата и недостаточного контроля состояния муфты. Разрушение подшипника является следствием, а не первопричиной.",
      eventChain: ["Замена/запуск резервного агрегата", "Разцентровка муфты", "Рост радиальной вибрации", "Перегрев подшипника", "Останов насоса"],
      immediateCause: "Перегрев и повреждение подшипникового узла из-за повышенной вибрации.",
      contributingFactors: ["Не зафиксированы измерения центровки после монтажа", "Нет тревоги по тренду вибрации на 1-м уровне", "Осмотр муфты не входил в чек-лист запуска"],
      rootCause: "Процесс ввода резервного насоса в эксплуатацию не содержит обязательной верификации центровки и контрольной вибродиагностики.",
      recommendations: [
        { priority: "P1", action: "Проверить центровку и состояние муфты P-204, повторить виброизмерения", owner: "Механическая служба", horizon: "24 часа" },
        { priority: "P1", action: "Добавить контроль центровки в чек-лист после монтажа и запуска", owner: "Технический надзор", horizon: "7 дней" },
        { priority: "P2", action: "Настроить предупреждение по тренду вибрации 6 мм/с", owner: "АСУ ТП", horizon: "30 дней" },
      ],
      confidence: 78,
      openQuestions: ["Есть ли протокол лазерной центровки после последней замены?", "Как изменился спектр вибрации перед остановом?"],
      methodNotes: "Гипотеза построена по цепочке событий, признакам повреждения и анализу барьеров. Требуется проверка первичных измерений.",
    },
    updatedAt: "22 сен, 16:40",
  },
  {
    id: "demo-2",
    title: "Падение подачи на Н-17",
    equipmentType: "Шламовый насос",
    assetTag: "Н-17 / 2B",
    location: "Зумпф флотации",
    severity: "Средний",
    status: "В работе",
    narrative: "Подача снизилась примерно на 35% без срабатывания защиты. Есть видео с шумом и показания давления на всасывании.",
    evidence: [
      { id: "e-3", kind: "video", name: "осмотр_Н17.mp4", createdAt: "Сегодня" },
      { id: "e-4", kind: "text", name: "Показания оператора", note: "Давление всасывания нестабильно", createdAt: "Сегодня" },
    ],
    updatedAt: "Сегодня, 09:12",
  },
];

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function formatNow() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

async function toDataUrl(uri: string, mimeType = "image/jpeg") {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return undefined;
  }
}

function Icon({ name, size = 20, color }: { name: React.ComponentProps<typeof MaterialIcons>["name"]; size?: number; color: string }) {
  return <MaterialIcons name={name} size={size} color={color} />;
}

function Pill({ children, color, background }: { children: string; color: string; background: string }) {
  return <View style={[styles.pill, { backgroundColor: background }]}><Text style={[styles.pillText, { color }]}>{children}</Text></View>;
}

function ActionButton({ label, icon, onPress, colors, primary = false, disabled = false }: { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; onPress: () => void; colors: ReturnType<typeof useColors>; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionButton, { backgroundColor: primary ? colors.primary : colors.surface, borderColor: primary ? colors.primary : colors.border, opacity: disabled ? 0.5 : pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <Icon name={icon} size={18} color={primary ? "#FFFFFF" : colors.primary} />
      <Text style={[styles.actionButtonText, { color: primary ? "#FFFFFF" : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const [cases, setCases] = useState<PumpCase[]>(demoCases);
  const [selectedId, setSelectedId] = useState(demoCases[0].id);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
  const [draftEvidence, setDraftEvidence] = useState<Evidence[]>([]);
  const [textEvidence, setTextEvidence] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const selectedCase = cases.find((item) => item.id === selectedId) ?? cases[0];
  const rcaMutation = trpc.rca.analyze.useMutation();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PumpCase[];
          if (parsed.length > 0) {
            setCases(parsed);
            setSelectedId(parsed[0].id);
          }
        } catch {
          // Keep the curated starter cases when local storage is invalid.
        }
      }
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (isLoaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  }, [cases, isLoaded]);

  const completedCount = useMemo(() => cases.filter((item) => item.status === "Готово").length, [cases]);
  const openCount = cases.length - completedCount;

  const updateCase = (next: PumpCase) => setCases((current) => current.map((item) => item.id === next.id ? next : item));

  const addEvidence = (item: Evidence) => {
    setDraftEvidence((current) => [...current, item]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };

  const pickMedia = async (mode: "gallery" | "camera" | "video") => {
    try {
      setIsPreparing(true);
      let result: ImagePicker.ImagePickerResult;
      if (mode === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("Нужен доступ к камере", "Разрешите доступ в настройках устройства, чтобы снять фото.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: mode === "video" ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.All, quality: 0.7, allowsMultipleSelection: true });
      }
      if (result.canceled) return;
      result.assets.forEach((asset) => addEvidence({ id: makeId("ev"), kind: asset.type === "video" ? "video" : "photo", name: asset.fileName ?? (asset.type === "video" ? "видео.mp4" : "фото.jpg"), uri: asset.uri, mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"), createdAt: "только что" }));
    } catch {
      Alert.alert("Не удалось добавить медиа", "Попробуйте выбрать файл ещё раз.");
    } finally {
      setIsPreparing(false);
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/plain", "text/csv", "application/pdf"], copyToCacheDirectory: true });
      if (!result.canceled) {
        const asset = result.assets[0];
        addEvidence({ id: makeId("ev"), kind: "file", name: asset.name, uri: asset.uri, mimeType: asset.mimeType, createdAt: "только что" });
      }
    } catch {
      Alert.alert("Не удалось добавить файл", "Проверьте, что файл доступен на устройстве.");
    }
  };

  const addTextEvidence = () => {
    if (!textEvidence.trim()) return;
    addEvidence({ id: makeId("ev"), kind: "text", name: "Заметка инспектора", note: textEvidence.trim(), createdAt: "только что" });
    setTextEvidence("");
  };

  const openNewCase = () => {
    setEditingId(null);
    setDraft({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
    setDraftEvidence([]);
    setTextEvidence("");
    setShowNewCase(true);
  };

  const openEvidenceEditor = (item: PumpCase) => {
    setEditingId(item.id);
    setDraft({ title: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative });
    setDraftEvidence(item.evidence);
    setTextEvidence("");
    setShowNewCase(true);
  };

  const createCase = () => {
    if (!draft.title.trim()) {
      Alert.alert("Укажите название", "Например: «Разрушение торцевого уплотнения Н-12».");
      return;
    }
    const newCase: PumpCase = { id: makeId("case"), title: draft.title.trim(), equipmentType: draft.equipmentType, assetTag: draft.assetTag.trim() || "Не указан", location: draft.location.trim() || "Не указано", severity: "Высокий", status: "В работе", narrative: draft.narrative.trim() || "Описание события пока не добавлено.", evidence: draftEvidence, updatedAt: formatNow() };
    if (editingId) {
      const existing = cases.find((item) => item.id === editingId);
      if (existing) {
        updateCase({ ...existing, title: newCase.title, equipmentType: newCase.equipmentType, assetTag: newCase.assetTag, location: newCase.location, narrative: newCase.narrative, evidence: newCase.evidence, status: "В работе", result: undefined, updatedAt: newCase.updatedAt });
        setSelectedId(existing.id);
      }
    } else {
      setCases((current) => [newCase, ...current]);
      setSelectedId(newCase.id);
    }
    setShowNewCase(false);
    setEditingId(null);
    setDraft({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
    setDraftEvidence([]);
    setTextEvidence("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const analyzeCase = async (item: PumpCase) => {
    setIsAnalyzing(true);
    try {
      const payloadEvidence = await Promise.all(item.evidence.map(async (entry) => {
        let imageData: string | undefined;
        if (entry.kind === "photo" && entry.uri) imageData = await toDataUrl(entry.uri, entry.mimeType);
        if (entry.kind === "video" && entry.uri) {
          try {
            const thumbnail = await VideoThumbnails.getThumbnailAsync(entry.uri, { time: 500 });
            imageData = await toDataUrl(thumbnail.uri, "image/jpeg");
          } catch {
            imageData = undefined;
          }
        }
        return { kind: entry.kind, name: entry.name, note: entry.note, imageData };
      }));
      const result = await rcaMutation.mutateAsync({ caseTitle: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative, evidence: payloadEvidence });
      updateCase({ ...item, result, status: "Готово", updatedAt: formatNow() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      Alert.alert("RCA готов", "Выводы сформированы. Проверьте гипотезы и открытые вопросы перед выпуском отчёта.");
    } catch {
      Alert.alert("Анализ не завершён", "Сервер анализа временно недоступен. Данные расследования сохранены на устройстве.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!selectedCase) return null;

  return (
    <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>PUMPRCA / FIELD MODE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Расследования отказов</Text>
        </View>
        <Pressable onPress={() => Alert.alert("PumpRCA", "Собирайте свидетельства на месте, а затем запускайте RCA-анализ по цепочке событий и барьерам.")} style={({ pressed }) => [styles.infoButton, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}>
          <Icon name="info-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.foreground }]}>{cases.length}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>всего кейсов</Text></View>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.warning }]}>{openCount}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>в работе</Text></View>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.success }]}>{completedCount}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>с выводом</Text></View>
        </View>

        <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Мои расследования</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>Свидетельства → гипотезы → корневая причина</Text></View><Pressable onPress={openNewCase} style={({ pressed }) => [styles.addCircle, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="add" size={24} color="#FFFFFF" /></Pressable></View>

        <FlatList
          data={cases}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelectedId(item.id)} style={({ pressed }) => [styles.caseCard, { backgroundColor: colors.surface, borderColor: item.id === selectedId ? colors.primary : colors.border, opacity: pressed ? 0.86 : 1 }]}>
              <View style={styles.caseTopLine}><View style={styles.caseIcon}><Icon name={item.equipmentType.includes("Шлам") ? "water" : "settings"} size={19} color={colors.primary} /></View><View style={styles.caseHeading}><Text numberOfLines={1} style={[styles.caseTitle, { color: colors.foreground }]}>{item.title}</Text><Text style={[styles.caseMeta, { color: colors.muted }]}>{item.assetTag} · {item.location}</Text></View><Icon name="chevron-right" size={21} color={colors.muted} /></View>
              <View style={styles.caseBottomLine}><Pill background={item.status === "Готово" ? "#E5F5EF" : "#FFF3DD"} color={item.status === "Готово" ? "#16805D" : "#A56600"}>{item.status}</Pill><Text style={[styles.updatedText, { color: colors.muted }]}>{item.updatedAt}</Text><Text style={[styles.evidenceCount, { color: colors.foreground }]}><Icon name="attach-file" size={15} color={colors.muted} /> {item.evidence.length}</Text></View>
            </Pressable>
          )}
        />

        <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.detailHeader}><View style={{ flex: 1 }}><Text style={[styles.detailEyebrow, { color: colors.primary }]}>АКТИВНЫЙ КЕЙС</Text><Text style={[styles.detailTitle, { color: colors.foreground }]}>{selectedCase.title}</Text></View><Pill background={selectedCase.severity === "Высокий" ? "#FFF0EC" : "#FFF3DD"} color={selectedCase.severity === "Высокий" ? "#C94D32" : "#A56600"}>{selectedCase.severity}</Pill></View>
          <Text style={[styles.detailNarrative, { color: colors.muted }]}>{selectedCase.narrative}</Text>
          <View style={styles.factGrid}><View><Text style={[styles.factLabel, { color: colors.muted }]}>Оборудование</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{selectedCase.equipmentType}</Text></View><View><Text style={[styles.factLabel, { color: colors.muted }]}>Локация</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{selectedCase.location}</Text></View></View>
          <View style={styles.detailActions}><ActionButton label="Добавить данные" icon="add-photo-alternate" onPress={() => openEvidenceEditor(selectedCase)} colors={colors} /><ActionButton label={isAnalyzing ? "Анализирую…" : "Запустить RCA"} icon={isAnalyzing ? "hourglass-top" : "auto-awesome"} onPress={() => analyzeCase(selectedCase)} colors={colors} primary={selectedCase.evidence.length > 0} disabled={isAnalyzing} /></View>
        </View>

        <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Материалы расследования</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{selectedCase.evidence.length} источника в кейсе</Text></View><Icon name="folder-open" size={22} color={colors.muted} /></View>
        <View style={styles.evidenceList}>{selectedCase.evidence.map((item) => <View key={item.id} style={[styles.evidenceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.evidenceIcon, { backgroundColor: item.kind === "photo" ? "#E7F0FF" : item.kind === "video" ? "#F2E9FF" : "#E5F5EF" }]}><Icon name={item.kind === "photo" ? "image" : item.kind === "video" ? "videocam" : item.kind === "file" ? "description" : "notes"} size={20} color={item.kind === "photo" ? "#3867D6" : item.kind === "video" ? "#8656C7" : "#16805D"} /></View><View style={{ flex: 1 }}><Text style={[styles.evidenceName, { color: colors.foreground }]}>{item.name}</Text><Text numberOfLines={1} style={[styles.evidenceNote, { color: colors.muted }]}>{item.note ?? (item.kind === "video" ? "Видеосвидетельство · будет взят кадр для AI-анализа" : "Добавлено в материалы кейса")}</Text></View><Icon name="check-circle" size={19} color={colors.success} /></View>)}</View>

        {selectedCase.result ? <RcaSummary result={selectedCase.result} colors={colors} /> : <View style={[styles.emptyRca, { backgroundColor: "#FFF8F3", borderColor: "#F6D6C8" }]}><View style={styles.emptyRcaIcon}><Icon name="auto-awesome" size={24} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.emptyRcaTitle, { color: colors.foreground }]}>RCA-вывод ещё не сформирован</Text><Text style={[styles.emptyRcaText, { color: colors.muted }]}>Добавьте факты, фотографии и видео. AI соберёт цепочку событий, разделит причины и покажет, чего не хватает для уверенного вывода.</Text></View></View>}
      </ScrollView>

      <Modal visible={showNewCase} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewCase(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}><View><Text style={[styles.modalEyebrow, { color: colors.primary }]}>{editingId ? "ДОПОЛНИТЬ КЕЙС" : "НОВОЕ РАССЛЕДОВАНИЕ"}</Text><Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingId ? "Обновить материалы" : "Собрать кейс"}</Text></View><Pressable onPress={() => setShowNewCase(false)} style={[styles.closeButton, { backgroundColor: colors.surface }]}><Icon name="close" size={21} color={colors.foreground} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Название отказа</Text><TextInput value={draft.title} onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))} placeholder="Например: разрушение торцевого уплотнения" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Тип оборудования</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}><EquipmentChip label="Центробежный насос" active={draft.equipmentType === "Центробежный насос"} onPress={() => setDraft((current) => ({ ...current, equipmentType: "Центробежный насос" }))} colors={colors} /><EquipmentChip label="Шламовый насос" active={draft.equipmentType === "Шламовый насос"} onPress={() => setDraft((current) => ({ ...current, equipmentType: "Шламовый насос" }))} colors={colors} /><EquipmentChip label="Дозировочный" active={draft.equipmentType === "Дозировочный"} onPress={() => setDraft((current) => ({ ...current, equipmentType: "Дозировочный" }))} colors={colors} /></ScrollView>
            <View style={styles.twoInputs}><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: colors.foreground }]}>Тег актива</Text><TextInput value={draft.assetTag} onChangeText={(value) => setDraft((current) => ({ ...current, assetTag: value }))} placeholder="P-204" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /></View><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: colors.foreground }]}>Локация</Text><TextInput value={draft.location} onChangeText={(value) => setDraft((current) => ({ ...current, location: value }))} placeholder="Цех 2" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /></View></View>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Что произошло?</Text><TextInput value={draft.narrative} onChangeText={(value) => setDraft((current) => ({ ...current, narrative: value }))} placeholder="Опишите события, симптомы и действия оператора…" placeholderTextColor={colors.muted} multiline numberOfLines={5} textAlignVertical="top" style={[styles.input, styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Свидетельства</Text><View style={styles.evidenceButtons}><EvidenceButton label="Фото" icon="photo-camera" onPress={() => pickMedia("camera")} colors={colors} /><EvidenceButton label="Галерея" icon="photo-library" onPress={() => pickMedia("gallery")} colors={colors} /><EvidenceButton label="Видео" icon="videocam" onPress={() => pickMedia("video")} colors={colors} /><EvidenceButton label="Файл" icon="attach-file" onPress={pickFile} colors={colors} /></View>
            <View style={styles.textEvidenceRow}><TextInput value={textEvidence} onChangeText={setTextEvidence} placeholder="Добавить показание, замер или факт…" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /><Pressable onPress={addTextEvidence} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="arrow-upward" size={20} color="#FFFFFF" /></Pressable></View>
            {isPreparing && <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Подготавливаю материалы…</Text></View>}
            {draftEvidence.length > 0 && <View style={styles.draftList}>{draftEvidence.map((item) => <View key={item.id} style={[styles.draftRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><Icon name={item.kind === "photo" ? "image" : item.kind === "video" ? "videocam" : item.kind === "file" ? "description" : "notes"} size={18} color={colors.primary} /><Text numberOfLines={1} style={[styles.draftName, { color: colors.foreground }]}>{item.name}</Text><Pressable onPress={() => setDraftEvidence((current) => current.filter((entry) => entry.id !== item.id))}><Icon name="remove-circle-outline" size={18} color={colors.muted} /></Pressable></View>)}</View>}
            <Pressable onPress={createCase} style={({ pressed }) => [styles.createButton, { backgroundColor: colors.primary, opacity: pressed ? 0.86 : 1 }]}><Icon name="add-task" size={20} color="#FFFFFF" /><Text style={styles.createButtonText}>{editingId ? "Сохранить материалы" : "Сохранить расследование"}</Text></Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

function EquipmentChip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 }]}><Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>{label}</Text></Pressable>;
}

function EvidenceButton({ label, icon, onPress, colors }: { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.evidenceButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}><Icon name={icon} size={20} color={colors.primary} /><Text style={[styles.evidenceButtonText, { color: colors.foreground }]}>{label}</Text></Pressable>;
}

function RcaSummary({ result, colors }: { result: RcaResult; colors: ReturnType<typeof useColors> }) {
  const confidenceBand = getConfidenceBand(result.confidence);
  const confidenceLabel = confidenceBand === "high" ? "высокая" : confidenceBand === "medium" ? "средняя" : "низкая";
  return <View style={[styles.rcaCard, { backgroundColor: colors.foreground }]}><View style={styles.rcaHeader}><View><Text style={styles.rcaEyebrow}>AI RCA / ВЫВОДЫ</Text><Text style={styles.rcaTitle}>Гипотеза корневой причины</Text></View><View style={styles.confidence}><Text style={styles.confidenceNumber}>{result.confidence}%</Text><Text style={styles.confidenceLabel}>{confidenceLabel} уверенность</Text></View></View><Text style={styles.rcaSummaryText}>{result.executiveSummary}</Text><View style={styles.rootCauseBlock}><Text style={styles.rootCauseLabel}>ROOT CAUSE</Text><Text style={styles.rootCauseText}>{result.rootCause}</Text></View><View style={styles.timeline}>{result.eventChain.slice(0, 5).map((event, index) => <View key={`${event}-${index}`} style={styles.timelineRow}><View style={styles.timelineDot}><Text style={styles.timelineIndex}>{index + 1}</Text></View><Text style={styles.timelineText}>{event}</Text></View>)}</View><Text style={styles.subsectionLabel}>Следующие действия</Text>{result.recommendations.slice(0, 3).map((recommendation) => <View key={recommendation.action} style={styles.recommendation}><View style={styles.recommendationBadge}><Text style={styles.recommendationBadgeText}>{recommendation.priority}</Text></View><View style={{ flex: 1 }}><Text style={styles.recommendationAction}>{recommendation.action}</Text><Text style={styles.recommendationMeta}>{recommendation.owner} · {recommendation.horizon}</Text></View></View>)}<View style={styles.openQuestions}><Icon name="help-outline" size={19} color="#F7B08E" /><Text style={styles.openQuestionsText}>{result.openQuestions.length} открытых вопроса требуют проверки на месте</Text></View></View>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 4 },
  title: { fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  infoButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 38, gap: 24 },
  kpiRow: { flexDirection: "row", gap: 10 },
  kpiCard: { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1 },
  kpiNumber: { fontSize: 24, fontWeight: "800", marginBottom: 2 },
  kpiLabel: { fontSize: 11, lineHeight: 15 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 12, marginTop: 3 },
  addCircle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  caseCard: { borderWidth: 1, borderRadius: 18, padding: 15, marginBottom: 10 },
  caseTopLine: { flexDirection: "row", alignItems: "center", gap: 11 },
  caseIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF0EC" },
  caseHeading: { flex: 1 },
  caseTitle: { fontSize: 15, fontWeight: "800" },
  caseMeta: { fontSize: 11, marginTop: 4 },
  caseBottomLine: { flexDirection: "row", alignItems: "center", marginTop: 14, gap: 10 },
  pill: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  pillText: { fontSize: 10, fontWeight: "800" },
  updatedText: { flex: 1, fontSize: 11 },
  evidenceCount: { fontSize: 12, fontWeight: "700" },
  detailCard: { borderWidth: 1, borderRadius: 20, padding: 17 },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  detailEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
  detailTitle: { fontSize: 20, fontWeight: "800", lineHeight: 25 },
  detailNarrative: { fontSize: 13, lineHeight: 20, marginTop: 14 },
  factGrid: { flexDirection: "row", gap: 20, marginTop: 17, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E7E8EB" },
  factLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  factValue: { fontSize: 12, fontWeight: "700" },
  detailActions: { flexDirection: "row", gap: 9, marginTop: 17 },
  actionButton: { flex: 1, minHeight: 44, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  actionButtonText: { fontSize: 12, fontWeight: "800" },
  evidenceList: { gap: 8 },
  evidenceRow: { borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  evidenceIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  evidenceName: { fontSize: 13, fontWeight: "800" },
  evidenceNote: { fontSize: 11, marginTop: 3 },
  emptyRca: { borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: "row", gap: 13 },
  emptyRcaIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  emptyRcaTitle: { fontSize: 14, fontWeight: "800", marginBottom: 5 },
  emptyRcaText: { fontSize: 12, lineHeight: 18 },
  rcaCard: { borderRadius: 20, padding: 18, gap: 15 },
  rcaHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  rcaEyebrow: { color: "#F7B08E", fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 4 },
  rcaTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  confidence: { alignItems: "flex-end" },
  confidenceNumber: { color: "#7BE4C0", fontSize: 21, fontWeight: "800" },
  confidenceLabel: { color: "#AEBBC7", fontSize: 10 },
  rcaSummaryText: { color: "#D7E0E6", fontSize: 13, lineHeight: 20 },
  rootCauseBlock: { borderLeftWidth: 3, borderLeftColor: "#F2673A", paddingLeft: 12, gap: 5 },
  rootCauseLabel: { color: "#F7B08E", fontSize: 10, letterSpacing: 1.1, fontWeight: "800" },
  rootCauseText: { color: "#FFFFFF", fontSize: 14, lineHeight: 21, fontWeight: "700" },
  timeline: { gap: 10 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timelineDot: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: "#607483", alignItems: "center", justifyContent: "center" },
  timelineIndex: { color: "#AEBBC7", fontSize: 10, fontWeight: "800" },
  timelineText: { color: "#D7E0E6", fontSize: 12, flex: 1 },
  subsectionLabel: { color: "#AEBBC7", fontSize: 10, letterSpacing: 1.1, fontWeight: "800", textTransform: "uppercase" },
  recommendation: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  recommendationBadge: { borderRadius: 6, backgroundColor: "#5B2E25", paddingHorizontal: 7, paddingVertical: 4 },
  recommendationBadgeText: { color: "#F7B08E", fontSize: 10, fontWeight: "800" },
  recommendationAction: { color: "#FFFFFF", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  recommendationMeta: { color: "#AEBBC7", fontSize: 10, marginTop: 3 },
  openQuestions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#405361", paddingTop: 14, flexDirection: "row", gap: 8, alignItems: "center" },
  openQuestionsText: { color: "#F7B08E", fontSize: 11, fontWeight: "700" },
  modal: { flex: 1 },
  modalHeader: { padding: 20, paddingTop: Platform.OS === "ios" ? 18 : 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E6E8EB" },
  modalEyebrow: { fontSize: 10, letterSpacing: 1.3, fontWeight: "800", marginBottom: 4 },
  modalTitle: { fontSize: 24, fontWeight: "800" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  modalContent: { padding: 20, paddingBottom: 50, gap: 10 },
  inputLabel: { fontSize: 12, fontWeight: "800", marginTop: 8, marginBottom: 1 },
  input: { minHeight: 46, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, fontSize: 13 },
  textarea: { minHeight: 116, paddingTop: 13 },
  twoInputs: { flexDirection: "row", gap: 10 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20 },
  chipText: { fontSize: 11, fontWeight: "700" },
  evidenceButtons: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  evidenceButton: { borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, flexDirection: "row", gap: 6, alignItems: "center" },
  evidenceButtonText: { fontSize: 11, fontWeight: "800" },
  textEvidenceRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 2 },
  sendButton: { width: 45, height: 45, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  loadingText: { fontSize: 12 },
  draftList: { gap: 7, marginTop: 3 },
  draftRow: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  draftName: { flex: 1, fontSize: 12, fontWeight: "700" },
  createButton: { minHeight: 51, borderRadius: 15, marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  createButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
});
