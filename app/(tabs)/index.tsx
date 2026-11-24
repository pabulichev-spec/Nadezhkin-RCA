import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as VideoThumbnails from "expo-video-thumbnails";
import * as ImageManipulator from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
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
import { PhotoAnnotationEditor } from "@/components/photo-annotation-editor";
import { RcaChat } from "@/components/rca-chat";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { getConfidenceBand, matchesCaseFilters, removeCaseById, type PhotoAnnotation } from "@/shared/rca";
import { buildRcaReportHtml } from "@/shared/report";
import type { RcaChatContext, RcaChatMessage } from "@/shared/chat";
import { makeAiCacheKey } from "@/shared/ai";
import { filterEquipmentTypes, isKnownEquipmentType } from "@/shared/equipment";
import { readAiCache, readAiUsage, recordAiUsage, writeAiCache } from "@/lib/ai-cache";

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
  annotations?: PhotoAnnotation[];
  fileSize?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  mediaHash?: string;
  createdAt: string;
};

type RcaResult = {
  executiveSummary: string;
  physicalCause: string;
  humanFactor: string;
  systemicCause: string;
  smartActions: { priority: string; specific: string; measurable: string; achievable: string; relevant: string; timeBound: string }[];
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
  tags: string[];
  chatHistory: RcaChatMessage[];
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
    tags: ["вибрация", "подшипник", "центровка"],
    chatHistory: [],
    result: {
      executiveSummary: "Наиболее вероятна комбинация разцентровки после смены агрегата и недостаточного контроля состояния муфты. Разрушение подшипника является следствием, а не первопричиной.",
      physicalCause: "Повышенная вибрация из-за вероятной разцентровки муфты вызвала перегрев и повреждение подшипника.",
      humanFactor: "После установки резервного агрегата не были зафиксированы контрольные измерения центровки, а осмотр муфты не вошёл в действия оператора при запуске.",
      systemicCause: "Процесс ввода резервного насоса в эксплуатацию не содержит обязательной верификации центровки и контрольной вибродиагностики.",
      smartActions: [
        { priority: "P1", specific: "Провести инструментальный контроль посадочных мест и центровки муфты P-204", measurable: "Получить вибрацию не выше 4 мм/с и оформить протокол измерений", achievable: "Силами механической службы и службы надёжности", relevant: "Для подтверждения качества ремонта и исключения повторного повреждения подшипника", timeBound: "До следующего пуска насоса" },
        { priority: "P1", specific: "Добавить обязательный пункт контроля центровки в чек-лист запуска", measurable: "100% запусков резервных насосов имеют подписанный чек-лист", achievable: "Владелец процесса — технический надзор", relevant: "Устраняет пропуск контрольной операции", timeBound: "В течение 7 календарных дней" },
        { priority: "P2", specific: "Настроить предупреждение по тренду вибрации", measurable: "Тревога формируется при достижении 6 мм/с", achievable: "Силами АСУ ТП", relevant: "Позволяет обнаружить деградацию до аварийного останова", timeBound: "В течение 30 дней" },
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
    tags: ["подача", "всасывание", "шлам"],
    chatHistory: [],
    updatedAt: "Сегодня, 09:12",
  },
];

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const MAX_IMAGE_DIMENSION = 1024;
const MAX_VIDEO_FRAMES = 20;
const MAX_TOTAL_VIDEO_FRAMES = 30;

async function makeMediaHash(asset: { uri: string; fileSize?: number; duration?: number; width?: number; height?: number }) {
  try {
    if (!asset.fileSize || asset.fileSize <= 50 * 1024 * 1024) {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
    }
  } catch {
    // Fall back to a stable fingerprint when the platform blocks full-file reads.
  }
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${asset.uri}|${asset.fileSize ?? 0}|${asset.duration ?? 0}|${asset.width ?? 0}x${asset.height ?? 0}`);
}

function formatNow() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function normalizeRcaResult(result: any): RcaResult {
  if (Array.isArray(result.smartActions)) return result as RcaResult;
  return {
    executiveSummary: result.executiveSummary ?? "Рабочая гипотеза сформирована по доступным материалам.",
    physicalCause: result.immediateCause ?? "Физическая причина не была выделена в старом формате отчёта.",
    humanFactor: Array.isArray(result.contributingFactors) ? result.contributingFactors.join("; ") : "Человеческий фактор требует уточнения по первичным данным.",
    systemicCause: result.rootCause ?? "Системная причина не была выделена в старом формате отчёта.",
    smartActions: Array.isArray(result.recommendations) ? result.recommendations.map((item: any) => ({ priority: item.priority ?? "P1", specific: item.action ?? "Уточнить корректирующее действие", measurable: "Зафиксировать измеримый результат в протоколе", achievable: item.owner ?? "Ответственный владелец процесса", relevant: "Связано с устранением причины отказа", timeBound: item.horizon ?? "Согласовать срок" })) : [],
    confidence: Number(result.confidence ?? 0),
    openQuestions: Array.isArray(result.openQuestions) ? result.openQuestions : [],
    methodNotes: result.methodNotes ?? "Требуется проверка ответственным специалистом.",
  };
}

async function toDataUrl(uri: string, mimeType = "image/jpeg") {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return undefined;
  }
}

async function compressMediaFrame(uri: string, width?: number, height?: number) {
  const maxSide = Math.max(width ?? MAX_IMAGE_DIMENSION, height ?? MAX_IMAGE_DIMENSION);
  const actions = maxSide > MAX_IMAGE_DIMENSION
    ? [{ resize: width && height && width >= height ? { width: MAX_IMAGE_DIMENSION } : { height: MAX_IMAGE_DIMENSION } }]
    : [];
  const result = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  return toDataUrl(result.uri, "image/jpeg");
}

function getVideoFrameTimes(durationMs?: number) {
  if (!durationMs || durationMs <= 0) return [500];
  const durationSeconds = durationMs / 1000;
  const intervalSeconds = durationSeconds > 30 ? 5 : 1;
  const count = Math.min(MAX_VIDEO_FRAMES, Math.max(1, Math.ceil(durationSeconds / intervalSeconds)));
  return Array.from({ length: count }, (_, index) => Math.min(durationMs - 1, Math.max(0, index * intervalSeconds * 1000)));
}

function askHeavyMediaConfirmation(item: Evidence) {
  const sizeMb = (item.fileSize ?? 0) / (1024 * 1024);
  const isHeavy = item.kind === "video" ? sizeMb > 10 : item.kind === "photo" && sizeMb > 5;
  if (!isHeavy) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => Alert.alert("Тяжёлый медиафайл", "Анализ этого файла может занять больше токенов. Продолжить?", [{ text: "Отмена", style: "cancel", onPress: () => resolve(false) }, { text: "Продолжить", onPress: () => resolve(true) }], { cancelable: false }));
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
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [customEquipment, setCustomEquipment] = useState("");
  const [textEvidence, setTextEvidence] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [annotationTarget, setAnnotationTarget] = useState<Evidence | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState("Все");
  const [activeStatus, setActiveStatus] = useState("Все");
  const filteredEquipmentTypes = useMemo(() => filterEquipmentTypes(equipmentSearch), [equipmentSearch]);

  const selectedCase = cases.find((item) => item.id === selectedId) ?? cases[0];
  const rcaMutation = trpc.rca.analyze.useMutation();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PumpCase[];
          if (parsed.length > 0) {
            const normalized = parsed.map((item) => ({ ...item, tags: item.tags?.length ? item.tags : item.id === "demo-1" ? ["вибрация", "подшипник", "центровка"] : item.id === "demo-2" ? ["подача", "всасывание", "шлам"] : [], chatHistory: item.chatHistory ?? [], result: item.result ? normalizeRcaResult(item.result) : undefined, evidence: item.evidence.map((entry) => ({ ...entry, annotations: entry.annotations ?? [] })) }));
            setCases(normalized);
            setSelectedId(normalized[0].id);
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
  const allTags = useMemo(() => ["Все", ...Array.from(new Set(cases.flatMap((item) => item.tags ?? []))).sort()], [cases]);
  const filteredCases = useMemo(() => cases.filter((item) => matchesCaseFilters(item, searchQuery, activeTag, activeStatus)), [activeStatus, activeTag, cases, searchQuery]);

  const updateCase = (next: PumpCase) => setCases((current) => current.map((item) => item.id === next.id ? next : item));

  const confirmDeleteCase = (item: PumpCase) => {
    Alert.alert("Удалить расследование?", "Вы уверены, что хотите удалить это расследование? Это действие нельзя отменить.", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => {
        const remaining = removeCaseById(cases, item.id);
        setCases(remaining);
        setSelectedId(remaining[0]?.id ?? "");
        setSearchQuery("");
        setActiveTag("Все");
        setActiveStatus("Все");
      } },
    ]);
  };

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
      const prepared = await Promise.all(result.assets.map(async (asset) => ({ id: makeId("ev"), kind: asset.type === "video" ? "video" as const : "photo" as const, name: asset.fileName ?? (asset.type === "video" ? "видео.mp4" : "фото.jpg"), uri: asset.uri, mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"), fileSize: asset.fileSize, durationMs: asset.duration ?? undefined, width: asset.width, height: asset.height, mediaHash: await makeMediaHash({ ...asset, duration: asset.duration ?? undefined }), createdAt: "только что" })));
      prepared.forEach(addEvidence);
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

  const addDraftTag = () => {
    const nextTag = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!nextTag || draftTags.includes(nextTag)) {
      setTagInput("");
      return;
    }
    setDraftTags((current) => [...current, nextTag]);
    setTagInput("");
  };

  const savePhotoAnnotations = (annotations: PhotoAnnotation[]) => {
    if (!annotationTarget) return;
    setDraftEvidence((current) => current.map((entry) => entry.id === annotationTarget.id ? { ...entry, annotations } : entry));
    if (editingId) {
      const existing = cases.find((item) => item.id === editingId);
      if (existing) {
        updateCase({ ...existing, evidence: existing.evidence.map((entry) => entry.id === annotationTarget.id ? { ...entry, annotations } : entry), status: "В работе", result: undefined, chatHistory: [], updatedAt: formatNow() });
      }
    }
    setAnnotationTarget(null);
  };

  const openNewCase = () => {
    setEditingId(null);
    setDraft({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
    setEquipmentSearch("");
    setCustomEquipment("");
    setDraftEvidence([]);
    setDraftTags([]);
    setTagInput("");
    setTextEvidence("");
    setShowNewCase(true);
  };

  const openEvidenceEditor = (item: PumpCase) => {
    setEditingId(item.id);
    setDraft({ title: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative });
    setEquipmentSearch("");
    setCustomEquipment(isKnownEquipmentType(item.equipmentType) ? "" : item.equipmentType);
    setDraftEvidence(item.evidence);
    setDraftTags(item.tags ?? []);
    setTagInput("");
    setTextEvidence("");
    setShowNewCase(true);
  };

  const createCase = () => {
    if (!draft.title.trim()) {
      Alert.alert("Укажите название", "Например: «Разрушение торцевого уплотнения Н-12».");
      return;
    }
    const newCase: PumpCase = { id: makeId("case"), title: draft.title.trim(), equipmentType: draft.equipmentType, assetTag: draft.assetTag.trim() || "Не указан", location: draft.location.trim() || "Не указано", severity: "Высокий", status: "В работе", narrative: draft.narrative.trim() || "Описание события пока не добавлено.", evidence: draftEvidence, tags: draftTags, chatHistory: [], updatedAt: formatNow() };
    if (editingId) {
      const existing = cases.find((item) => item.id === editingId);
      if (existing) {
        updateCase({ ...existing, title: newCase.title, equipmentType: newCase.equipmentType, assetTag: newCase.assetTag, location: newCase.location, narrative: newCase.narrative, evidence: newCase.evidence, tags: newCase.tags, status: "В работе", result: undefined, chatHistory: [], updatedAt: newCase.updatedAt });
        setSelectedId(existing.id);
      }
    } else {
      setCases((current) => [newCase, ...current]);
      setSelectedId(newCase.id);
    }
    setShowNewCase(false);
    setEditingId(null);
    setDraft({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
    setEquipmentSearch("");
    setCustomEquipment("");
    setDraftEvidence([]);
    setDraftTags([]);
    setTagInput("");
    setTextEvidence("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const analyzeCase = async (item: PumpCase, cacheOnly = false) => {
    setIsAnalyzing(true);
    try {
      const cacheKey = makeAiCacheKey("rca", { title: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative, evidence: item.evidence.map((entry) => ({ kind: entry.kind, identity: entry.mediaHash ?? `${entry.name}|${entry.note ?? ""}`, fileSize: entry.fileSize, durationMs: entry.durationMs, width: entry.width, height: entry.height, note: entry.note, annotations: entry.annotations })) });
      const cachedResult = await readAiCache<RcaResult>(cacheKey);
      if (cachedResult) {
        updateCase({ ...item, result: cachedResult, status: "Готово", updatedAt: formatNow() });
        const usage = await readAiUsage();
        await recordAiUsage({ cacheHits: usage.cacheHits + 1 });
        Alert.alert("RCA из кэша", "Для этого набора данных уже есть сохранённый результат. Новый AI-вызов не выполнялся.");
        return;
      }
      if (cacheOnly) {
        Alert.alert("В кэше нет результата", "AI-вызов не выполнялся. Сначала запустите обычный RCA-анализ, чтобы сохранить результат в кэш.");
        return;
      }
      for (const evidence of item.evidence) {
        if (!(await askHeavyMediaConfirmation(evidence))) return;
      }
      const usage = await readAiUsage();
      await recordAiUsage({ cacheMisses: usage.cacheMisses + 1, rcaCalls: usage.rcaCalls + 1 });
      let totalVideoFrames = 0;
      const payloadEvidence = (await Promise.all(item.evidence.map(async (entry) => {
        const annotationNote = entry.annotations?.length ? `Маркеры на фото: ${entry.annotations.map((annotation) => annotation.text).join("; ")}` : "";
        if (entry.kind === "video" && entry.uri) {
          const frameTimes = getVideoFrameTimes(entry.durationMs).slice(0, Math.max(0, Math.min(MAX_VIDEO_FRAMES, MAX_TOTAL_VIDEO_FRAMES - totalVideoFrames)));
          totalVideoFrames += frameTimes.length;
          const frames = await Promise.all(frameTimes.map(async (time, index) => {
            try {
              const thumbnail = await VideoThumbnails.getThumbnailAsync(entry.uri!, { time, quality: 0.8 });
              const imageData = await compressMediaFrame(thumbnail.uri, thumbnail.width, thumbnail.height);
              return { kind: "video" as const, name: `${entry.name} · кадр ${index + 1}/${frameTimes.length}`, note: [entry.note, annotationNote, `Кадр ${Math.round(time / 1000)} с`].filter(Boolean).join(". "), imageData };
            } catch {
              return undefined;
            }
          }));
          return frames.filter((frame): frame is NonNullable<typeof frame> => Boolean(frame));
        }
        const imageData = entry.kind === "photo" && entry.uri ? await compressMediaFrame(entry.uri, entry.width, entry.height) : undefined;
        return [{ kind: entry.kind, name: entry.name, note: [entry.note, annotationNote].filter(Boolean).join(". "), imageData }];
      }))).flat();
      const result = await rcaMutation.mutateAsync({ caseTitle: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative, evidence: payloadEvidence });
      await writeAiCache(cacheKey, result);
      updateCase({ ...item, result, status: "Готово", chatHistory: [], updatedAt: formatNow() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      Alert.alert("RCA готов", "Выводы сформированы. Проверьте гипотезы и открытые вопросы перед выпуском отчёта.");
    } catch {
      Alert.alert("Анализ не завершён", "Сервер анализа временно недоступен. Данные расследования сохранены на устройстве.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportRcaReport = async (item: PumpCase) => {
    if (!item.result) {
      Alert.alert("Сначала сформируйте RCA", "Итоговый PDF появится после завершения анализа выбранного кейса.");
      return;
    }
    setIsExporting(true);
    try {
      const evidence = await Promise.all(item.evidence.map(async (entry) => ({
        kind: entry.kind,
        name: entry.name,
        note: entry.note,
        annotations: entry.annotations,
        imageData: entry.kind === "photo" && entry.uri ? await toDataUrl(entry.uri, entry.mimeType) : undefined,
      })));
      const html = buildRcaReportHtml({ ...item, evidence }, formatNow());
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: ".pdf", dialogTitle: "Экспорт RCA-отчёта" });
      } else {
        Alert.alert("PDF создан", `Файл отчёта сохранён: ${uri}`);
      }
    } catch {
      Alert.alert("Не удалось экспортировать PDF", "Попробуйте ещё раз после формирования RCA-вывода.");
    } finally {
      setIsExporting(false);
    }
  };

  if (!selectedCase) return <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}><View style={[styles.header, { borderBottomColor: colors.border }]}><View><Text style={[styles.eyebrow, { color: colors.primary }]}>НАДЁЖКИН / FIELD MODE</Text><Text style={[styles.title, { color: colors.foreground }]}>Расследования отказов</Text></View></View><View style={styles.emptyState}><Icon name="folder-open" size={42} color={colors.muted} /><Text style={[styles.emptyStateTitle, { color: colors.foreground }]}>Расследований пока нет</Text><Text style={[styles.emptyStateText, { color: colors.muted }]}>Создайте новое расследование, чтобы собрать материалы и запустить RCA-анализ.</Text><Pressable onPress={openNewCase} style={[styles.createButton, { backgroundColor: colors.primary, paddingHorizontal: 20 }]}><Icon name="add" size={20} color="#FFFFFF" /><Text style={styles.createButtonText}>Новое расследование</Text></Pressable></View></ScreenContainer>;

  return (
    <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>НАДЁЖКИН / FIELD MODE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Расследования отказов</Text>
        </View>
        <Pressable onPress={() => Alert.alert("Надёжкин", "Собирайте свидетельства на месте, а затем запускайте RCA-анализ по цепочке событий и барьерам.")} style={({ pressed }) => [styles.infoButton, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}>
          <Icon name="info-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.foreground }]}>{cases.length}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>всего кейсов</Text></View>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.warning }]}>{openCount}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>в работе</Text></View>
          <View style={[styles.kpiCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.success }]}>{completedCount}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>с выводом</Text></View>
        </View>

        <View style={[styles.filterPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.searchBox, { borderColor: colors.border }]}><Icon name="search" size={19} color={colors.muted} /><TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Поиск по кейсам, активам и тегам" placeholderTextColor={colors.muted} style={[styles.searchInput, { color: colors.foreground }]} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>{allTags.map((tag) => <FilterChip key={tag} label={tag} active={activeTag === tag} onPress={() => setActiveTag(tag)} colors={colors} />)}</ScrollView>
          <View style={styles.statusFilters}><Text style={[styles.filterLabel, { color: colors.muted }]}>Статус</Text><FilterChip label="Все" active={activeStatus === "Все"} onPress={() => setActiveStatus("Все")} colors={colors} /><FilterChip label="В работе" active={activeStatus === "В работе"} onPress={() => setActiveStatus("В работе")} colors={colors} /><FilterChip label="Готово" active={activeStatus === "Готово"} onPress={() => setActiveStatus("Готово")} colors={colors} /></View>
        </View>

        <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Мои расследования</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{filteredCases.length} из {cases.length} · свидетельства → RCA</Text></View><Pressable onPress={openNewCase} style={({ pressed }) => [styles.addCircle, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="add" size={24} color="#FFFFFF" /></Pressable></View>

        <FlatList
          data={filteredCases}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          ListEmptyComponent={<View style={[styles.noResults, { backgroundColor: colors.surface, borderColor: colors.border }]}><Icon name="filter-alt-off" size={22} color={colors.muted} /><Text style={[styles.noResultsText, { color: colors.muted }]}>По заданным фильтрам кейсы не найдены.</Text></View>}
          renderItem={({ item }) => (
            <Pressable onPress={() => setSelectedId(item.id)} style={({ pressed }) => [styles.caseCard, { backgroundColor: colors.surface, borderColor: item.id === selectedId ? colors.primary : colors.border, opacity: pressed ? 0.86 : 1 }]}>
              <View style={styles.caseTopLine}><View style={styles.caseIcon}><Icon name={item.equipmentType.includes("Шлам") ? "water" : "settings"} size={19} color={colors.primary} /></View><View style={styles.caseHeading}><Text numberOfLines={1} style={[styles.caseTitle, { color: colors.foreground }]}>{item.title}</Text><Text style={[styles.caseMeta, { color: colors.muted }]}>{item.assetTag} · {item.location}</Text><View style={styles.tagRow}>{(item.tags ?? []).slice(0, 3).map((tag) => <View key={tag} style={styles.miniTag}><Text style={[styles.miniTagText, { color: colors.primary }]}>#{tag}</Text></View>)}</View></View><Icon name="chevron-right" size={21} color={colors.muted} /></View>
              <View style={styles.caseBottomLine}><Pill background={item.status === "Готово" ? "#E5F5EF" : "#FFF3DD"} color={item.status === "Готово" ? "#16805D" : "#A56600"}>{item.status}</Pill><Text style={[styles.updatedText, { color: colors.muted }]}>{item.updatedAt}</Text><Text style={[styles.evidenceCount, { color: colors.foreground }]}><Icon name="attach-file" size={15} color={colors.muted} /> {item.evidence.length}</Text></View>
            </Pressable>
          )}
        />

        <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.detailHeader}><View style={{ flex: 1 }}><Text style={[styles.detailEyebrow, { color: colors.primary }]}>АКТИВНЫЙ КЕЙС</Text><Text style={[styles.detailTitle, { color: colors.foreground }]}>{selectedCase.title}</Text></View><Pill background={selectedCase.severity === "Высокий" ? "#FFF0EC" : "#FFF3DD"} color={selectedCase.severity === "Высокий" ? "#C94D32" : "#A56600"}>{selectedCase.severity}</Pill></View>
          <Text style={[styles.detailNarrative, { color: colors.muted }]}>{selectedCase.narrative}</Text>
          <View style={styles.factGrid}><View><Text style={[styles.factLabel, { color: colors.muted }]}>Оборудование</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{selectedCase.equipmentType}</Text></View><View><Text style={[styles.factLabel, { color: colors.muted }]}>Локация</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{selectedCase.location}</Text></View></View>
          <View style={styles.detailActions}><ActionButton label="Добавить данные" icon="add-photo-alternate" onPress={() => openEvidenceEditor(selectedCase)} colors={colors} /><ActionButton label={isAnalyzing ? "Анализирую…" : "Запустить RCA"} icon={isAnalyzing ? "hourglass-top" : "auto-awesome"} onPress={() => analyzeCase(selectedCase)} colors={colors} primary={selectedCase.evidence.length > 0} disabled={isAnalyzing} /><ActionButton label="Только кэш" icon="cached" onPress={() => analyzeCase(selectedCase, true)} colors={colors} disabled={isAnalyzing} /><Pressable onPress={() => confirmDeleteCase(selectedCase)} style={({ pressed }) => [styles.deleteButton, { borderColor: colors.error, opacity: pressed ? 0.72 : 1 }]}><Icon name="delete-outline" size={18} color={colors.error} /><Text style={[styles.deleteButtonText, { color: colors.error }]}>Удалить</Text></Pressable></View>
        </View>

        <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Материалы расследования</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{selectedCase.evidence.length} источника в кейсе</Text></View><Icon name="folder-open" size={22} color={colors.muted} /></View>
        <View style={styles.evidenceList}>{selectedCase.evidence.map((item) => <View key={item.id} style={[styles.evidenceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.evidenceIcon, { backgroundColor: item.kind === "photo" ? "#E7F0FF" : item.kind === "video" ? "#F2E9FF" : "#E5F5EF" }]}><Icon name={item.kind === "photo" ? "image" : item.kind === "video" ? "videocam" : item.kind === "file" ? "description" : "notes"} size={20} color={item.kind === "photo" ? "#3867D6" : item.kind === "video" ? "#8656C7" : "#16805D"} /></View><View style={{ flex: 1 }}><Text style={[styles.evidenceName, { color: colors.foreground }]}>{item.name}</Text><Text numberOfLines={1} style={[styles.evidenceNote, { color: colors.muted }]}>{item.note ?? (item.kind === "video" ? "Видеосвидетельство · будет взят кадр для AI-анализа" : item.annotations?.length ? `${item.annotations.length} маркеров повреждений` : "Добавлено в материалы кейса")}</Text></View>{item.kind === "photo" && <Pressable onPress={() => { setEditingId(selectedCase.id); setDraftEvidence(selectedCase.evidence); setAnnotationTarget(item); }} style={styles.annotateSmall}><Icon name="edit" size={16} color={colors.primary} /></Pressable>}<Icon name="check-circle" size={19} color={colors.success} /></View>)}</View>

        {selectedCase.result ? <RcaSummary result={selectedCase.result} colors={colors} onExport={() => exportRcaReport(selectedCase)} isExporting={isExporting} onHistoryChange={(history) => updateCase({ ...selectedCase, chatHistory: history })} chatContext={{ caseTitle: selectedCase.title, equipmentType: selectedCase.equipmentType, assetTag: selectedCase.assetTag, location: selectedCase.location, narrative: selectedCase.narrative, result: selectedCase.result, evidence: selectedCase.evidence.map((entry) => ({ kind: entry.kind, name: entry.name, note: entry.note })), history: selectedCase.chatHistory ?? [] }} /> : <View style={[styles.emptyRca, { backgroundColor: "#FFF8F3", borderColor: "#F6D6C8" }]}><View style={styles.emptyRcaIcon}><Icon name="auto-awesome" size={24} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.emptyRcaTitle, { color: colors.foreground }]}>RCA-вывод ещё не сформирован</Text><Text style={[styles.emptyRcaText, { color: colors.muted }]}>Добавьте факты, фотографии и видео. AI соберёт цепочку событий, разделит причины и покажет, чего не хватает для уверенного вывода.</Text></View></View>}
      </ScrollView>

      <Modal visible={showNewCase} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewCase(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}><View><Text style={[styles.modalEyebrow, { color: colors.primary }]}>{editingId ? "ДОПОЛНИТЬ КЕЙС" : "НОВОЕ РАССЛЕДОВАНИЕ"}</Text><Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingId ? "Обновить материалы" : "Собрать кейс"}</Text></View><Pressable onPress={() => setShowNewCase(false)} style={[styles.closeButton, { backgroundColor: colors.surface }]}><Icon name="close" size={21} color={colors.foreground} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Название отказа</Text><TextInput value={draft.title} onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))} placeholder="Например: разрушение торцевого уплотнения" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Тип оборудования</Text><View style={[styles.equipmentPicker, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.background }]}><Icon name="search" size={18} color={colors.muted} /><TextInput value={equipmentSearch} onChangeText={setEquipmentSearch} placeholder="Поиск: например, пор..." placeholderTextColor={colors.muted} style={[styles.searchInput, { color: colors.foreground }]} /></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.equipmentChipRow}>{filteredEquipmentTypes.map((type) => <EquipmentChip key={type} label={type} active={draft.equipmentType === type} onPress={() => { setDraft((current) => ({ ...current, equipmentType: type })); setCustomEquipment(""); }} colors={colors} />)}<EquipmentChip label="Другой" active={Boolean(customEquipment) || !isKnownEquipmentType(draft.equipmentType)} onPress={() => setDraft((current) => ({ ...current, equipmentType: customEquipment || "" }))} colors={colors} /></ScrollView>{filteredEquipmentTypes.length === 0 && <Text style={[styles.noEquipmentText, { color: colors.muted }]}>Ничего не найдено. Выберите «Другой» и укажите тип вручную.</Text>}{(Boolean(customEquipment) || !isKnownEquipmentType(draft.equipmentType)) && <TextInput value={customEquipment} onChangeText={(value) => { setCustomEquipment(value); setDraft((current) => ({ ...current, equipmentType: value })); }} placeholder="Введите тип оборудования" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />}</View>
            <View style={styles.twoInputs}><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: colors.foreground }]}>Тег актива</Text><TextInput value={draft.assetTag} onChangeText={(value) => setDraft((current) => ({ ...current, assetTag: value }))} placeholder="P-204" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /></View><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: colors.foreground }]}>Локация</Text><TextInput value={draft.location} onChangeText={(value) => setDraft((current) => ({ ...current, location: value }))} placeholder="Цех 2" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /></View></View>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Что произошло?</Text><TextInput value={draft.narrative} onChangeText={(value) => setDraft((current) => ({ ...current, narrative: value }))} placeholder="Опишите события, симптомы и действия оператора…" placeholderTextColor={colors.muted} multiline numberOfLines={5} textAlignVertical="top" style={[styles.input, styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Теги кейса</Text><View style={styles.textEvidenceRow}><TextInput value={tagInput} onChangeText={setTagInput} onSubmitEditing={addDraftTag} placeholder="например: вибрация" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="done" /><Pressable onPress={addDraftTag} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="add" size={20} color="#FFFFFF" /></Pressable></View>
            {draftTags.length > 0 && <View style={styles.tagInputList}>{draftTags.map((tag) => <Pressable key={tag} onPress={() => setDraftTags((current) => current.filter((entry) => entry !== tag))} style={[styles.formTag, { backgroundColor: "#FFF0EC" }]}><Text style={[styles.formTagText, { color: colors.primary }]}>#{tag}</Text><Icon name="close" size={13} color={colors.primary} /></Pressable>)}</View>}
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Свидетельства</Text><View style={styles.evidenceButtons}><EvidenceButton label="Фото" icon="photo-camera" onPress={() => pickMedia("camera")} colors={colors} /><EvidenceButton label="Галерея" icon="photo-library" onPress={() => pickMedia("gallery")} colors={colors} /><EvidenceButton label="Видео" icon="videocam" onPress={() => pickMedia("video")} colors={colors} /><EvidenceButton label="Файл" icon="attach-file" onPress={pickFile} colors={colors} /></View>
            <View style={styles.textEvidenceRow}><TextInput value={textEvidence} onChangeText={setTextEvidence} placeholder="Добавить показание, замер или факт…" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /><Pressable onPress={addTextEvidence} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="arrow-upward" size={20} color="#FFFFFF" /></Pressable></View>
            {isPreparing && <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Подготавливаю материалы…</Text></View>}
            {draftEvidence.length > 0 && <View style={styles.draftList}>{draftEvidence.map((item) => <View key={item.id} style={[styles.draftRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><Icon name={item.kind === "photo" ? "image" : item.kind === "video" ? "videocam" : item.kind === "file" ? "description" : "notes"} size={18} color={colors.primary} /><Text numberOfLines={1} style={[styles.draftName, { color: colors.foreground }]}>{item.name}</Text>{item.kind === "photo" && <Pressable onPress={() => setAnnotationTarget(item)} style={styles.annotateDraft}><Icon name="edit" size={17} color={colors.primary} /></Pressable>}<Pressable onPress={() => setDraftEvidence((current) => current.filter((entry) => entry.id !== item.id))}><Icon name="remove-circle-outline" size={18} color={colors.muted} /></Pressable></View>)}</View>}
            <Pressable onPress={createCase} style={({ pressed }) => [styles.createButton, { backgroundColor: colors.primary, opacity: pressed ? 0.86 : 1 }]}><Icon name="add-task" size={20} color="#FFFFFF" /><Text style={styles.createButtonText}>{editingId ? "Сохранить материалы" : "Сохранить расследование"}</Text></Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <PhotoAnnotationEditor visible={Boolean(annotationTarget)} uri={annotationTarget?.uri} fileName={annotationTarget?.name ?? "Фото"} annotations={annotationTarget?.annotations ?? []} onSave={savePhotoAnnotations} onClose={() => setAnnotationTarget(null)} />
    </ScreenContainer>
  );
}

function EquipmentChip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 }]}><Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>{label}</Text></Pressable>;
}

function FilterChip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.filterChip, { backgroundColor: active ? "#FFF0EC" : colors.background, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.78 : 1 }]}><Text style={[styles.filterChipText, { color: active ? colors.primary : colors.muted }]}>{label}</Text></Pressable>;
}

function EvidenceButton({ label, icon, onPress, colors }: { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.evidenceButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}><Icon name={icon} size={20} color={colors.primary} /><Text style={[styles.evidenceButtonText, { color: colors.foreground }]}>{label}</Text></Pressable>;
}

function RcaSummary({ result, colors, onExport, isExporting, chatContext, onHistoryChange }: { result: RcaResult; colors: ReturnType<typeof useColors>; onExport: () => void; isExporting: boolean; chatContext: RcaChatContext; onHistoryChange: (history: RcaChatMessage[]) => void }) {
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
  filterPanel: { borderWidth: 1, borderRadius: 17, padding: 12, gap: 10 },
  searchBox: { minHeight: 42, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 8 },
  searchInput: { flex: 1, minHeight: 40, fontSize: 12 },
  filterScroll: { gap: 7 },
  statusFilters: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  filterLabel: { fontSize: 11, fontWeight: "800", marginRight: 1 },
  noResults: { borderWidth: 1, borderRadius: 16, minHeight: 80, alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10 },
  noResultsText: { fontSize: 12 },
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
  tagRow: { flexDirection: "row", gap: 5, marginTop: 6, flexWrap: "wrap" },
  miniTag: { backgroundColor: "#FFF0EC", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  miniTagText: { fontSize: 9, fontWeight: "800" },
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
  annotateSmall: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF0EC" },
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
  pdfButton: { minHeight: 45, borderRadius: 12, backgroundColor: "#F2673A", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pdfButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  deleteButton: { minHeight: 44, borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center" },
  deleteButtonText: { fontSize: 11, fontWeight: "800" },
  analysisBlock: { borderTopWidth: 1, borderTopColor: "#3A3A3A", paddingTop: 13, gap: 7 },
  blockHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  blockNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#F2673A", alignItems: "center", justifyContent: "center" },
  blockNumberText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  blockTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  blockText: { color: "#F2F4F5", fontSize: 13, lineHeight: 20 },
  smartAction: { backgroundColor: "#2A2A2A", borderRadius: 10, padding: 11, gap: 5 },
  smartTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  smartActionTitle: { color: "#FFFFFF", fontSize: 12, lineHeight: 17, fontWeight: "700", flex: 1 },
  smartLine: { color: "#E5E7E9", fontSize: 11, lineHeight: 16 },
  smartKey: { color: "#F7B08E", fontWeight: "800" },
  resultStack: { gap: 12 },
  modal: { flex: 1 },
  modalHeader: { padding: 20, paddingTop: Platform.OS === "ios" ? 18 : 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E6E8EB" },
  modalEyebrow: { fontSize: 10, letterSpacing: 1.3, fontWeight: "800", marginBottom: 4 },
  modalTitle: { fontSize: 24, fontWeight: "800" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  modalContent: { padding: 20, paddingBottom: 50, gap: 10 },
  inputLabel: { fontSize: 12, fontWeight: "800", marginTop: 8, marginBottom: 1 },
  input: { minHeight: 46, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, fontSize: 13 },
  textarea: { minHeight: 116, paddingTop: 13 },
  equipmentPicker: { borderWidth: 1, borderRadius: 15, padding: 10, gap: 9 },
  equipmentChipRow: { gap: 8, paddingRight: 4 },
  noEquipmentText: { fontSize: 11, lineHeight: 16, paddingHorizontal: 3 },
  twoInputs: { flexDirection: "row", gap: 10 },
  tagInputList: { flexDirection: "row", gap: 7, flexWrap: "wrap" },
  formTag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 },
  formTagText: { fontSize: 11, fontWeight: "800" },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20 },
  chipText: { fontSize: 11, fontWeight: "700" },
  filterChip: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 },
  filterChipText: { fontSize: 10, fontWeight: "800" },
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
  annotateDraft: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF0EC" },
  createButton: { minHeight: 51, borderRadius: 15, marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  createButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  emptyStateTitle: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  emptyStateText: { fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 360 },
});
