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
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useFocusEffect, useRouter } from "expo-router";
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
  useWindowDimensions,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { PhotoAnnotationEditor } from "@/components/photo-annotation-editor";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { getConfidenceBand, isValidCacheableRcaResult, matchesCaseFilters, normalizeLegacyRcaResult, removeCaseById, type PhotoAnnotation, type StructuredRca } from "@/shared/rca";
import { buildRcaReportHtml } from "@/shared/report";
import type { RcaChatMessage } from "@/shared/chat";
import { makeAiCacheKey, RCA_CACHE_PROMPT_VERSION, RCA_CACHE_SCHEMA_VERSION, RCA_CACHE_VALIDATOR_VERSION } from "@/shared/ai";
import { EQUIPMENT_GROUPS, getEquipmentGroup } from "@/shared/equipment";
import { readAiCache, readAiUsage, recordAiUsage, removeAiCache, writeAiCache } from "@/lib/ai-cache";
import { PumpRcaRepository } from "@/lib/domain-repository";
import { subscribeDomainChanges } from "@/lib/domain-events";
import { getAllowedTransitions, getStatusLabel, getStatusProgress, transitionInvestigation, type WorkflowTransition } from "@/shared/domain/workflow";
import type { AuditEvent, DomainState, Investigation, InvestigationStatus } from "@/shared/domain/types";
import { exportInvestigation, serializeArchive } from "@/lib/pumprca-transfer";
import { createRcaTasks } from "@/shared/domain/rca-workspace";
import { getDashboardMetrics } from "@/shared/dashboard";
import { getEquipmentMetrics } from "@/shared/equipment-metrics";
import { isSupportedAiDocumentMime } from "@/shared/ai-media";
import { createTRPCClient } from "@/lib/trpc";
import { canUseRemoteRca, NATIVE_RCA_UNAVAILABLE_MESSAGE } from "@/lib/rca-routing";
import * as Auth from "@/lib/_core/auth";
import { startOAuthLogin } from "@/constants/oauth";

const STORAGE_KEY = "pumprca.cases.v1";
const formatDashboardDate = (value: Date) => value.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

const CASE_EQUIPMENT_CLASSES = [
  { id: "pumps", label: "Насосы", icon: "waves" as const, description: "Центробежные, объёмные и специальные насосы", groupIds: ["pumps"] },
  { id: "drives", label: "Приводы и вращение", icon: "settings" as const, description: "Электродвигатели, редукторы и мешалки", groupIds: ["motors", "gearboxes", "mixers"] },
  { id: "compressors", label: "Компрессоры и вентиляторы", icon: "air" as const, description: "Оборудование для воздуха и газов", groupIds: ["compressors", "fans"] },
  { id: "centrifuges", label: "Центрифуги и сепараторы", icon: "sync" as const, description: "Разделение фаз вращением", groupIds: ["centrifuges"] },
  { id: "static", label: "Статическое оборудование", icon: "business" as const, description: "Колонны, сосуды, резервуары и теплообменники", groupIds: ["columns", "vessels", "tanks", "heat-exchangers"] },
] as const;

const caseEquipmentModels = (classId: string) => {
  const groupIds = CASE_EQUIPMENT_CLASSES.find((item) => item.id === classId)?.groupIds ?? ["pumps"];
  return groupIds.flatMap((groupId) => {
    const group = getEquipmentGroup(groupId);
    return group ? group.models.map((model) => ({ model, description: group.description, capabilities: group.capabilities, groupId })) : [];
  });
};

const classForEquipmentModel = (model: string) => CASE_EQUIPMENT_CLASSES.find((item) => caseEquipmentModels(item.id).some((entry) => entry.model === model))?.id ?? "pumps";

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
  structuredRca: StructuredRca;
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
  legacyResult?: unknown;
  updatedAt: string;
  workflowStatus?: InvestigationStatus;
};

function normalizeRcaForDisplay(value: unknown): RcaResult | undefined {
  const normalized = normalizeLegacyRcaResult(value);
  return normalized as RcaResult | undefined;
}

class RcaSummaryBoundary extends Component<{ children: ReactNode; colors: ReturnType<typeof useColors>; onReset: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Не записываем в журналы содержимое RCA, prompt или ответ модели.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={[styles.emptyRca, { backgroundColor: this.props.colors.surface, borderColor: this.props.colors.error }]}>
      <Icon name="error-outline" size={24} color={this.props.colors.error} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.emptyRcaTitle, { color: this.props.colors.foreground }]}>Вывод временно недоступен</Text>
        <Text style={[styles.emptyRcaText, { color: this.props.colors.muted }]}>Ответ анализа сохранён, но его отображение не удалось подготовить. Повторите анализ после проверки материалов.</Text>
        <Pressable onPress={this.props.onReset} style={({ pressed }) => [styles.pdfButton, { marginTop: 12, opacity: pressed ? 0.75 : 1 }]}>
          <Text style={styles.pdfButtonText}>Скрыть повреждённый вывод</Text>
        </Pressable>
      </View>
    </View>;
  }
}

const demoCases: PumpCase[] = [
  {
    id: "demo-1",
    title: "Пример: вибрация на насосе P-204",
    equipmentType: "Центробежный насос",
    assetTag: "P-204 / 4A",
    location: "Участок водооборота",
    severity: "Высокий",
    status: "В работе",
    narrative: "Учебный кейс для знакомства с интерфейсом (не AI-анализ). После запуска резервного агрегата выросла вибрация на подшипниковом узле. Через 40 минут оператор остановил насос.",
    evidence: [
      { id: "e-1", kind: "photo", name: "подшипник_01.jpg", note: "Следы перегрева на наружном кольце", createdAt: "2026-09-22" },
      { id: "e-2", kind: "text", name: "Журнал смены", note: "Вибрация 8.4 мм/с, рост за 3 часа", createdAt: "2026-09-22" },
    ],
    tags: ["вибрация", "подшипник", "центровка"],
    chatHistory: [],
    updatedAt: "22 сен, 16:40",
  },
  {
    id: "demo-2",
    title: "Пример: падение подачи на Н-17",
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
const MAX_TOTAL_VIDEO_FRAMES = 20;

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

function formatConfidenceLabel(value: string) {
  return value === "high" ? "Высокая" : value === "medium" ? "Средняя" : "Низкая";
}

function formatPriority(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "high") return "Высокий";
  if (normalized === "medium") return "Средний";
  if (normalized === "low") return "Низкий";
  return value;
}

function formatHypothesisStatus(value: string) {
  return value.replace("OPEN", "ОТКРЫТА").replace("CONFIRMED", "ПОДТВЕРЖДЕНА").replace("REJECTED", "ОТКЛОНЕНА").replace("INSUFFICIENT_DATA", "НЕТ ДАННЫХ");
}

function formatEvidenceSource(value: string) {
  return value.replace("USER_PROVIDED", "ОТ ПОЛЬЗОВАТЕЛЯ").replace("MEASUREMENT", "ИЗМЕРЕНИЕ").replace("DOCUMENT", "ДОКУМЕНТ").replace("AI_DERIVED", "ВЫВОД ИИ");
}

async function toDataUrl(uri: string, mimeType = "image/jpeg") {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return undefined;
  }
}

async function readUriAsBase64(uri: string) {
  if (Platform.OS !== "web") {
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`WEB_MEDIA_READ_FAILED_${response.status}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function compressMediaFrame(uri: string, width?: number, height?: number) {
  const maxSide = Math.max(width ?? MAX_IMAGE_DIMENSION, height ?? MAX_IMAGE_DIMENSION);
  const actions = maxSide > MAX_IMAGE_DIMENSION
    ? [{ resize: width && height && width >= height ? { width: MAX_IMAGE_DIMENSION } : { height: MAX_IMAGE_DIMENSION } }]
    : [];
  const result = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  return toDataUrl(result.uri, "image/jpeg");
}

async function extractBrowserVideoFrame(uri: string, timeMs: number, width?: number, height?: number) {
  if (typeof document === "undefined") throw new Error("BROWSER_VIDEO_REQUIRES_BROWSER");
  const video = document.createElement("video");
  video.src = uri;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("VIDEO_METADATA_TIMEOUT")), 15_000);
    video.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(); };
    video.onerror = () => { window.clearTimeout(timeout); reject(new Error("VIDEO_DECODE_FAILED")); };
    video.load();
  });
  const targetWidth = Math.min(MAX_IMAGE_DIMENSION, width || video.videoWidth || MAX_IMAGE_DIMENSION);
  const targetHeight = Math.min(MAX_IMAGE_DIMENSION, height || video.videoHeight || MAX_IMAGE_DIMENSION);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(video.videoWidth || targetWidth, video.videoHeight || targetHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((video.videoWidth || targetWidth) * scale));
  canvas.height = Math.max(1, Math.round((video.videoHeight || targetHeight) * scale));
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("VIDEO_SEEK_TIMEOUT")), 15_000);
    video.onseeked = () => { window.clearTimeout(timeout); resolve(); };
    video.onerror = () => { window.clearTimeout(timeout); reject(new Error("VIDEO_SEEK_FAILED")); };
    video.currentTime = Math.max(0, timeMs / 1000);
  });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("VIDEO_CANVAS_UNAVAILABLE");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.removeAttribute("src");
  video.load();
  return canvas.toDataURL("image/jpeg", 0.8);
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

type NavItem = { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; route?: string; active?: boolean };

function ReliabilitySidebar({ colors, router, compact, onToggle }: { colors: ReturnType<typeof useColors>; router: ReturnType<typeof useRouter>; compact: boolean; onToggle: () => void }) {
  const items: NavItem[] = [
    { label: "Обзор", icon: "dashboard", active: true },
    { label: "Расследования", icon: "assignment", active: true },
    { label: "Методика", icon: "account-tree", route: "./methodology" },
    { label: "ИИ и кэш", icon: "auto-awesome", route: "./usage" },
    { label: "Реестр оборудования", icon: "settings-input-component", route: "./pumps" },
    { label: "База знаний", icon: "menu-book", route: "./knowledge" },
  ];
  return (
    <View style={[styles.sidebar, { backgroundColor: "#11181D", borderRightColor: "#27343B" }, compact && styles.sidebarCompact]}>
      <View style={styles.brandBlock}>
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Icon name="settings" size={19} color="#11181D" /></View>
        {!compact && <View><Text style={styles.brandName}>Надёжкин</Text><Text style={styles.brandCaption}>ЦЕНТР НАДЁЖНОСТИ</Text></View>}
        {compact && <Pressable onPress={onToggle} style={styles.sidebarClose}><Icon name="close" size={19} color="#B2C0C7" /></Pressable>}
      </View>
      <Text style={styles.navCaption}>РАБОТА</Text>
      <View style={styles.navList}>
        {items.map((item) => <Pressable key={item.label} onPress={() => item.route ? router.push(item.route as never) : undefined} style={({ pressed }) => [styles.navItem, item.active && styles.navItemActive, pressed && { opacity: 0.72 }]}>
          <Icon name={item.icon} size={19} color={item.active ? colors.primary : "#91A0A8"} />
          <Text style={[styles.navText, { color: item.active ? "#F4F7F8" : "#91A0A8" }]}>{item.label}</Text>
        </Pressable>)}
      </View>
      <View style={styles.sidebarFooter}><Text style={styles.navCaption}>СИСТЕМА</Text><Pressable onPress={() => router.push("./settings" as never)} style={styles.navItem}><Icon name="tune" size={19} color="#91A0A8" /><Text style={styles.navText}>Настройки</Text></Pressable><View style={styles.offlineBadge}><View style={styles.onlineDot} /><Text style={styles.offlineText}>СЕРВЕРНЫЙ ИИ · 0 ₽</Text></View></View>
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const router = useRouter();
  const trpcClient = useMemo(() => createTRPCClient(), []);
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktop = viewportWidth >= 900;
  const domainRepository = useRef(new PumpRcaRepository()).current;
  const [cases, setCases] = useState<PumpCase[]>(demoCases);
  const [selectedId, setSelectedId] = useState(demoCases[0].id);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
  const [selectedEquipmentClass, setSelectedEquipmentClass] = useState("pumps");
  const [draftEvidence, setDraftEvidence] = useState<Evidence[]>([]);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const dashboardDate = formatDashboardDate(new Date());
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [textEvidence, setTextEvidence] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisFrame, setAnalysisFrame] = useState("");
  const analysisRunning = useRef(false);
  const analysisCancelled = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [annotationTarget, setAnnotationTarget] = useState<Evidence | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState("Все");
  const [activeStatus, setActiveStatus] = useState("Все");
  const [domainInvestigations, setDomainInvestigations] = useState<Record<string, Investigation>>({});
  const [domainState, setDomainState] = useState<DomainState>();
  const serverInvestigationIds = useRef<Record<string, string>>({});
  const serverEvidenceIds = useRef<Record<string, string>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [returnTarget, setReturnTarget] = useState<InvestigationStatus | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [compactNavOpen, setCompactNavOpen] = useState(false);
  const caseModels = useMemo(() => {
    const query = equipmentSearch.trim().toLocaleLowerCase("ru-RU");
    return caseEquipmentModels(selectedEquipmentClass).filter((item) => !query || `${item.model} ${item.description} ${item.capabilities.join(" ")}`.toLocaleLowerCase("ru-RU").includes(query));
  }, [equipmentSearch, selectedEquipmentClass]);
  const selectedCaseModel = caseEquipmentModels(selectedEquipmentClass).find((item) => item.model === draft.equipmentType);

  const refreshDomainState = useCallback(async () => {
    setDomainState(await domainRepository.getState());
  }, [domainRepository]);

  useFocusEffect(useCallback(() => {
    refreshDomainState().catch(() => undefined);
    return subscribeDomainChanges(() => { refreshDomainState().catch(() => undefined); });
  }, [refreshDomainState]));


  const selectedCase = cases.find((item) => item.id === selectedId) ?? cases[0];
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PumpCase[];
          if (parsed.length > 0) {
            const normalized = parsed.map((item) => {
              const oldSampleReport = item.id === "demo-1" && item.result?.executiveSummary?.startsWith("Наиболее вероятна комбинация разцентровки");
              const legacyResult = oldSampleReport ? undefined : normalizeLegacyRcaResult(item.result);
              return { ...item, title: item.id.startsWith("demo-") && !item.title.startsWith("Пример:") ? `Пример: ${item.title}` : item.title, status: oldSampleReport || (item.result && !legacyResult) ? "В работе" as const : item.status, tags: item.tags?.length ? item.tags : item.id === "demo-1" ? ["вибрация", "подшипник", "центровка"] : item.id === "demo-2" ? ["подача", "всасывание", "шлам"] : [], chatHistory: item.chatHistory ?? [], result: legacyResult as RcaResult | undefined, legacyResult: item.result, evidence: item.evidence.map((entry) => ({ ...entry, annotations: entry.annotations ?? [] })) };
            });
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
    if (!isLoaded || !selectedCase) return;
    refreshWorkflow(selectedCase).catch(() => undefined);
  // Refresh only when the selected legacy case changes or initial storage finishes loading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, selectedCase?.id]);


  useEffect(() => {
    if (isLoaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  }, [cases, isLoaded]);

  const completedCount = useMemo(() => cases.filter((item) => item.status === "Готово").length, [cases]);
  const openCount = cases.length - completedCount;
  const dashboardMetrics = useMemo(() => getDashboardMetrics(cases), [cases]);
  const equipmentMetrics = useMemo(() => domainState ? getEquipmentMetrics(domainState) : { total: 0, active: 0, attention: 0, ready: 0 }, [domainState]);
  const allTags = useMemo(() => ["Все", ...Array.from(new Set(cases.flatMap((item) => item.tags ?? []))).sort()], [cases]);
  const filteredCases = useMemo(() => cases.filter((item) => matchesCaseFilters(item, searchQuery, activeTag, activeStatus)), [activeStatus, activeTag, cases, searchQuery]);

  const updateCase = (next: PumpCase) => setCases((current) => current.map((item) => item.id === next.id ? next : item));

  const ensureServerInvestigation = async (item: PumpCase) => {
    const cachedId = serverInvestigationIds.current[item.id];
    if (cachedId) return cachedId;
    try {
      const workspaces = await trpcClient.workspace.list.query();
      const workspaceRecord = workspaces[0] ?? { workspace: await trpcClient.workspace.create.mutate({ name: "Надёжкин — рабочее пространство" }) };
      const workspace = workspaceRecord.workspace;
      const existing = await trpcClient.investigation.list.query({ workspaceId: workspace.id });
      const match = existing.find((entry) => entry.legacyCaseId === item.id);
      const investigation = match ?? await trpcClient.investigation.create.mutate({
        workspaceId: workspace.id,
        legacyCaseId: item.id,
        title: item.title,
        equipmentType: item.equipmentType,
        assetTag: item.assetTag,
        location: item.location,
        narrative: item.narrative,
        severity: item.severity,
        status: item.status,
        tagsSnapshot: item.tags,
        legacyData: { localCaseId: item.id },
      });
      serverInvestigationIds.current[item.id] = investigation.id;
      return investigation.id;
    } catch {
      // Unauthenticated/offline web sessions continue using the existing local-first workflow.
      return undefined;
    }
  };

  const uploadWebEvidence = async (item: PumpCase, investigationId: string) => {
    const existing = await trpcClient.investigation.evidence.query({ investigationId });
    for (const entry of item.evidence) {
      if (serverEvidenceIds.current[entry.id]) continue;
      if (entry.kind === "text") {
        if (!entry.note) continue;
        const saved = await trpcClient.investigation.addEvidence.mutate({
          investigationId,
          evidence: { kind: entry.kind, name: entry.name, note: entry.note, annotations: entry.annotations },
        });
        serverEvidenceIds.current[entry.id] = saved.id;
        continue;
      }
      if (!entry.uri) continue;
      const alreadyUploaded = existing.find((candidate) =>
        (entry.mediaHash && candidate.mediaHash === entry.mediaHash) ||
        (!entry.mediaHash && candidate.name === entry.name && candidate.sizeBytes === entry.fileSize),
      );
      if (alreadyUploaded) {
        serverEvidenceIds.current[entry.id] = alreadyUploaded.id;
        continue;
      }
      // RCA consumes locally extracted, compressed video frames; uploading the
      // original video is optional and must not block analysis of large videos.
      const fileInfo = await FileSystem.getInfoAsync(entry.uri);
      const localSizeBytes = ("size" in fileInfo ? fileInfo.size ?? 0 : 0) || entry.fileSize || 0;
      if (entry.kind === "video" && localSizeBytes > 10 * 1024 * 1024) {
        const saved = await trpcClient.investigation.addEvidence.mutate({
          investigationId,
          evidence: {
            kind: entry.kind,
            name: entry.name,
            mimeType: entry.mimeType ?? "video/mp4",
            sizeBytes: localSizeBytes,
            mediaHash: entry.mediaHash,
            note: entry.note,
            annotations: entry.annotations,
            metadata: { width: entry.width, height: entry.height, durationMs: entry.durationMs, originalStorage: "local-device-only", analysisInput: "extracted-frames" },
          },
        });
        serverEvidenceIds.current[entry.id] = saved.id;
        continue;
      }
      if (localSizeBytes > 10 * 1024 * 1024) {
        throw new Error(`Файл «${entry.name}» превышает серверный лимит 10 МБ. Сожмите его или выберите другой файл.`);
      }
      const base64 = await readUriAsBase64(entry.uri);
      const sizeBytes = Math.ceil(base64.length * 3 / 4);
      if (sizeBytes > 10 * 1024 * 1024) {
        if (entry.kind !== "video") throw new Error(`Файл «${entry.name}» превышает серверный лимит 10 МБ. Сожмите его или выберите другой файл.`);
        const saved = await trpcClient.investigation.addEvidence.mutate({
          investigationId,
          evidence: {
            kind: entry.kind,
            name: entry.name,
            mimeType: entry.mimeType ?? "video/mp4",
            sizeBytes,
            mediaHash: entry.mediaHash,
            note: entry.note,
            annotations: entry.annotations,
            metadata: { width: entry.width, height: entry.height, durationMs: entry.durationMs, originalStorage: "local-device-only", analysisInput: "extracted-frames" },
          },
        });
        serverEvidenceIds.current[entry.id] = saved.id;
        continue;
      }
      const saved = await trpcClient.investigation.uploadEvidence.mutate({
        investigationId,
        file: {
          name: entry.name,
          mimeType: entry.mimeType ?? "application/octet-stream",
          base64,
          kind: entry.kind,
          note: entry.note,
          mediaHash: entry.mediaHash,
          metadata: { width: entry.width, height: entry.height, durationMs: entry.durationMs },
          annotations: entry.annotations,
        },
      });
      serverEvidenceIds.current[entry.id] = saved.id;
    }
  };

  const syncServerCase = async (item: PumpCase) => {
    const investigationId = await ensureServerInvestigation(item);
    if (!investigationId) return;
    await trpcClient.investigation.update.mutate({
      investigationId,
      patch: {
        title: item.title,
        equipmentType: item.equipmentType,
        assetTag: item.assetTag,
        location: item.location,
        narrative: item.narrative,
        severity: item.severity,
        status: item.status,
        tagsSnapshot: item.tags,
        legacyData: { localCaseId: item.id },
      },
    });
  };

  const syncRcaResultToDomain = async (item: PumpCase, result: RcaResult) => {
    const investigation = await ensureDomainInvestigation(item);
    const updated = await domainRepository.replaceInvestigation({
      ...investigation,
      legacyData: { ...(investigation.legacyData ?? {}), result, rcaResultSchemaVersion: RCA_CACHE_SCHEMA_VERSION },
    });
    setDomainInvestigations((current) => ({ ...current, [item.id]: updated }));
    return updated;
  };

  const ensureDomainInvestigation = async (item: PumpCase): Promise<Investigation> => {
    const existing = domainInvestigations[item.id];
    if (existing) return existing;
    const state = await domainRepository.getState();
    const fromState = state.investigations.find((entry) => entry.legacyCaseId === item.id || entry.id === item.id);
    if (fromState) {
      const existingTasks = state.tasks.filter((task) => task.investigationId === fromState.id);
      if (existingTasks.length < 16) {
        const missingTasks = createRcaTasks(fromState.id).filter((task) => !existingTasks.some((current) => current.number === task.number));
        for (const task of missingTasks) await domainRepository.saveTask(task);
        fromState.taskIds = [...existingTasks, ...missingTasks].map((task) => task.id);
        await domainRepository.replaceInvestigation(fromState);
      }
      setDomainInvestigations((current) => ({ ...current, [item.id]: fromState }));
      return fromState;
    }
    const equipmentGroup = EQUIPMENT_GROUPS.find((entry) => (entry.models as readonly string[]).includes(item.equipmentType)) ?? EQUIPMENT_GROUPS[0];
    const equipment = await domainRepository.createEquipment({
      assetTag: item.assetTag,
      groupId: equipmentGroup.id,
      groupLabel: equipmentGroup.label,
      kind: equipmentGroup.kind,
      model: item.equipmentType,
      location: item.location,
      characteristics: {},
      capabilities: [...equipmentGroup.capabilities],
      components: [],
      measurements: [],
      history: [],
    });
    const created = await domainRepository.createInvestigation({ pumpId: equipment.id, title: item.title, narrative: item.narrative, severity: item.severity, tags: item.tags });
    const investigation = await domainRepository.replaceInvestigation({
      ...created,
      legacyCaseId: item.id,
      legacyData: item.legacyResult === undefined ? undefined : { result: item.legacyResult },
    });
    for (const task of createRcaTasks(investigation.id)) await domainRepository.saveTask(task);
    setDomainInvestigations((current) => ({ ...current, [item.id]: investigation }));
    return investigation;
  };

  const refreshWorkflow = async (item: PumpCase) => {
    const investigation = await ensureDomainInvestigation(item);
    const events = await domainRepository.getAuditEvents(investigation.id);
    setAuditEvents(events);
    return investigation;
  };

  const performWorkflowTransition = async (item: PumpCase, target: InvestigationStatus, reason?: string) => {
    try {
      const investigation = await ensureDomainInvestigation(item);
      const updated = await transitionInvestigation(domainRepository, investigation.id, target, { reason });
      setDomainInvestigations((current) => ({ ...current, [item.id]: updated }));
      setAuditEvents(await domainRepository.getAuditEvents(updated.id));
      Alert.alert("Статус изменён", `Расследование переведено в «${getStatusLabel(updated.status)}».`);
    } catch (error) {
      Alert.alert("Переход запрещён", error instanceof Error ? error.message : "Не удалось изменить статус расследования.");
    }
  };

  const requestWorkflowTransition = async (item: PumpCase, transition: WorkflowTransition) => {
    if (transition.requiresReason) {
      setReturnTarget(transition.to);
      setReturnReason("");
      return;
    }
    await performWorkflowTransition(item, transition.to);
  };

  const confirmDeleteCase = (item: PumpCase) => {
    Alert.alert("Удалить расследование?", "Вы уверены, что хотите удалить это расследование? Это действие нельзя отменить.", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: async () => {
        try {
          const investigationId = serverInvestigationIds.current[item.id] ?? await ensureServerInvestigation(item);
          if (investigationId) await trpcClient.investigation.delete.mutate({ investigationId });
          delete serverInvestigationIds.current[item.id];
        } catch (error) {
          Alert.alert("Удаление не выполнено", error instanceof Error ? error.message : "Сервер не подтвердил удаление расследования.");
          return;
        }
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
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/plain", "text/csv", "text/markdown", "application/json", "application/pdf"], copyToCacheDirectory: true });
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
    setSelectedEquipmentClass("pumps");
    setEquipmentSearch("");
    setDraftEvidence([]);
    setDraftTags([]);
    setTagInput("");
    setTextEvidence("");
    setShowNewCase(true);
  };

  const openEvidenceEditor = (item: PumpCase) => {
    setEditingId(item.id);
    setDraft({ title: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative });
    setSelectedEquipmentClass(classForEquipmentModel(item.equipmentType));
    setEquipmentSearch("");
    setDraftEvidence(item.evidence);
    setDraftTags(item.tags ?? []);
    setTagInput("");
    setTextEvidence("");
    setShowNewCase(true);
  };

  const createCase = async () => {
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
    try {
      await syncServerCase(newCase);
    } catch {
      Alert.alert("Локально сохранено", "Сервер не подтвердил сохранение расследования. Локальная копия сохранена; повторите действие при доступном соединении.");
    }
    setShowNewCase(false);
    setEditingId(null);
    setDraft({ title: "", equipmentType: "Центробежный насос", assetTag: "", location: "", narrative: "" });
    setSelectedEquipmentClass("pumps");
    setEquipmentSearch("");
    setDraftEvidence([]);
    setDraftTags([]);
    setTagInput("");
    setTextEvidence("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const analyzeCase = async (item: PumpCase, cacheOnly = false) => {
    setIsAnalyzing(true);
    try {
      const cacheKey = makeAiCacheKey("rca", { schemaVersion: RCA_CACHE_SCHEMA_VERSION, promptVersion: RCA_CACHE_PROMPT_VERSION, validatorVersion: RCA_CACHE_VALIDATOR_VERSION, title: item.title, equipmentType: item.equipmentType, assetTag: item.assetTag, location: item.location, narrative: item.narrative, evidence: item.evidence.map((entry) => ({ kind: entry.kind, identity: entry.mediaHash ?? `${entry.name}|${entry.note ?? ""}`, fileSize: entry.fileSize, durationMs: entry.durationMs, width: entry.width, height: entry.height, note: entry.note, annotations: entry.annotations })) });
      const cachedResult = await readAiCache<RcaResult>(cacheKey);
      if (cachedResult !== undefined) {
        if (isValidCacheableRcaResult(cachedResult)) {
          await syncRcaResultToDomain(item, cachedResult);
          updateCase({ ...item, result: cachedResult, status: "Готово", updatedAt: formatNow() });
          const usage = await readAiUsage();
          await recordAiUsage({ cacheHits: usage.cacheHits + 1 });
          Alert.alert("RCA из кэша", "Для этого набора данных уже есть сохранённый результат. Новый AI-вызов не выполнялся.");
          return;
        }
        await removeAiCache(cacheKey);
      }
      if (cacheOnly) {
        Alert.alert("В кэше нет результата", "AI-вызов не выполнялся. Сначала запустите обычный RCA-анализ, чтобы сохранить результат в кэш.");
        return;
      }
      if (Platform.OS !== "web" && !(await Auth.getSessionToken())) {
        const message = "Для серверного RCA нужно войти в рабочее пространство. Локальные данные сохранены; сейчас откроется окно входа.";
        setAnalysisError(message);
        Alert.alert("Требуется вход", message, [{ text: "OK" }]);
        await startOAuthLogin();
        return;
      }
      if (!canUseRemoteRca(Platform.OS === "web" ? "web" : "native")) {
        const message = NATIVE_RCA_UNAVAILABLE_MESSAGE;
        setAnalysisError(message);
        Alert.alert("Локальный RCA недоступен", message);
        return;
      }
      if (item.evidence.some((entry) => (entry.kind === "photo" || entry.kind === "video") && !entry.uri)) {
        throw new Error("Фото/видео без локального файла нельзя анализировать. Прикрепите оригинальные материалы заново.");
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
              const imageData = Platform.OS === "web"
                ? await extractBrowserVideoFrame(entry.uri!, time, entry.width, entry.height)
                : await (async () => {
                  const thumbnail = await VideoThumbnails.getThumbnailAsync(entry.uri!, { time, quality: 0.8 });
                  return compressMediaFrame(thumbnail.uri, thumbnail.width, thumbnail.height);
                })();
              return { kind: "video" as const, name: `${entry.name} · кадр ${index + 1}/${frameTimes.length}`, sourceName: entry.name, timestampMs: time, note: [entry.note, annotationNote, `Кадр ${Math.round(time / 1000)} с`].filter(Boolean).join(". "), imageData, fileData: undefined, mimeType: undefined };
            } catch {
              return undefined;
            }
          }));
          const available = frames.filter((frame): frame is NonNullable<typeof frame> => Boolean(frame?.imageData));
          if (!available.length) throw new Error(`Не удалось извлечь кадры из ${entry.name}. Видео не было проанализировано.`);
          return available;
        }
        const imageData = entry.kind === "photo" && entry.uri ? await compressMediaFrame(entry.uri, entry.width, entry.height) : undefined;
        if (entry.kind === "photo" && !imageData) throw new Error(`Не удалось прочитать фотографию ${entry.name}. Анализ без изображения запрещён.`);
        let fileData: string | undefined;
        if (entry.kind === "file" && entry.uri) {
          const info = await FileSystem.getInfoAsync(entry.uri);
          const size = "size" in info ? info.size ?? 0 : 0;
          if (size > 5_500_000) throw new Error(`Документ ${entry.name} слишком большой для бесплатного AI-маршрута (максимум 5,5 МБ).`);
          const reportedMime = (entry.mimeType || "").split(";")[0].trim().toLowerCase();
          const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
          const mimeByExtension: Record<string, string> = { pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", md: "text/markdown", markdown: "text/markdown" };
          const mime = isSupportedAiDocumentMime(reportedMime) ? reportedMime : mimeByExtension[extension] ?? (reportedMime || "application/octet-stream");
          if (!isSupportedAiDocumentMime(mime)) throw new Error(`Формат ${mime} пока не поддерживается бесплатным документным AI-маршрутом. Используйте PDF, TXT, CSV, JSON или Markdown.`);
          const base64 = await FileSystem.readAsStringAsync(entry.uri, { encoding: FileSystem.EncodingType.Base64 });
          fileData = `data:${mime};base64,${base64}`;
        }
        return [{ kind: entry.kind, name: entry.name, note: [entry.note, annotationNote].filter(Boolean).join(". "), imageData, fileData, mimeType: entry.mimeType }];
      }))).flat();
      analysisRunning.current = true;
      analysisCancelled.current = false;
      setAnalysisError("");
      if (analysisCancelled.current) throw new Error("Анализ отменён пользователем.");
      setAnalysisPhase("Передаю сжатые материалы в web AI Gateway");
      const serverInvestigationId = await ensureServerInvestigation(item);
      if (serverInvestigationId) {
        setAnalysisPhase("Сохраняю материалы в приватном хранилище");
        await uploadWebEvidence(item, serverInvestigationId);
      }
      setAnalysisPhase("Передаю сжатые материалы в web AI Gateway");
      const rawResult = await trpcClient.rca.analyze.mutate({
        investigationId: serverInvestigationId,
        caseTitle: item.title,
        equipmentType: item.equipmentType,
        assetTag: item.assetTag,
        location: item.location,
        narrative: item.narrative,
        evidence: payloadEvidence.map((entry) => ({
          kind: entry.kind,
          name: entry.name,
          note: entry.note,
          imageData: entry.imageData,
          fileData: entry.fileData,
          mimeType: entry.mimeType,
          sourceName: "sourceName" in entry ? entry.sourceName : undefined,
          timestampMs: "timestampMs" in entry ? entry.timestampMs : undefined,
        })),
      });
      const result = normalizeRcaForDisplay(rawResult);
      if (!result) throw new Error("Сервер вернул неполный или несовместимый результат RCA. Вывод не сохранён как успешный.");
      await syncRcaResultToDomain(item, result);
      await writeAiCache(cacheKey, result);
      updateCase({ ...item, result, status: "Готово", chatHistory: [], updatedAt: formatNow() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      Alert.alert("RCA готов", "Выводы сформированы. Проверьте гипотезы и открытые вопросы перед выпуском отчёта.");
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error ?? "");
      const message = rawMessage.includes("HTTP 502") || rawMessage.includes("HTTP 503")
        ? "Backend AI Gateway временно недоступен (HTTP 502/503). RCA не выполнен; данные расследования сохранены."
        : rawMessage.includes("NATIVE_LOG_BEGIN") || rawMessage.includes("STACKTRACE=")
        ? "Локальная модель не смогла завершить анализ. Техническая причина сохранена в диагностическом журнале устройства."
        : (rawMessage || "Локальный inference завершился ошибкой. Данные расследования сохранены на устройстве.");
      setAnalysisError(message);
      Alert.alert("Анализ ИИ не завершён", message.slice(0, 500));
    } finally {
      analysisRunning.current = false;
      setAnalysisFrame("");
      setAnalysisPhase("");
      setIsAnalyzing(false);
    }
  };

  const exportRcaReport = async (item: PumpCase) => {
    const investigation = await ensureDomainInvestigation(item);
    const domainState = await domainRepository.getState();
    const result = item.result ?? (investigation.legacyData?.result as RcaResult | undefined);
    if (!result) {
      Alert.alert("Сначала сформируйте RCA", "Итоговый PDF появится после завершения анализа выбранного кейса.");
      return;
    }
    setIsExporting(true);
    try {
      const domainEvidence = domainState.evidence.filter((entry) => entry.investigationId === investigation.id);
      const evidenceById = new Map(item.evidence.map((entry) => [entry.id, entry]));
      for (const entry of domainEvidence) {
        const legacy = evidenceById.get(entry.id);
        evidenceById.set(entry.id, { ...entry, ...legacy, kind: (legacy?.kind ?? entry.kind) as EvidenceKind, name: legacy?.name ?? entry.name, note: legacy?.note ?? entry.note });
      }
      const evidence = await Promise.all([...evidenceById.values()].map(async (entry) => ({
        kind: entry.kind,
        name: entry.name,
        note: entry.note,
        annotations: entry.annotations,
        imageData: entry.kind === "photo" && entry.uri ? await toDataUrl(entry.uri, entry.mimeType) : undefined,
      })));
      const pump = domainState.pumps.find((entry) => entry.id === investigation.pumpId);
      const html = buildRcaReportHtml({
        title: item.title,
        equipmentType: pump?.equipmentType ?? item.equipmentType,
        assetTag: pump?.assetTag ?? item.assetTag,
        location: pump?.location ?? item.location,
        severity: investigation.severity ?? item.severity,
        narrative: investigation.narrative || item.narrative,
        tags: investigation.tags.length ? investigation.tags : item.tags,
        evidence,
        result,
        workspace: {
          failureEvent: investigation.failureEvent,
          timeline: domainState.timeline.filter((entry) => entry.investigationId === investigation.id),
          measurements: domainState.measurements.filter((entry) => entry.investigationId === investigation.id),
          hypotheses: domainState.hypotheses.filter((entry) => entry.investigationId === investigation.id),
          tasks: domainState.tasks.filter((entry) => entry.investigationId === investigation.id),
          causeNodes: domainState.causes.filter((entry) => entry.investigationId === investigation.id),
          fiveWhys: investigation.fiveWhys,
          rootCause: investigation.rootCause,
          actions: domainState.actions.filter((entry) => entry.investigationId === investigation.id),
          effectiveness: investigation.effectiveness,
        },
      }, formatNow());
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

  const exportPumprca = async (item: PumpCase) => {
    try {
      const investigation = await ensureDomainInvestigation(item);
      const state = await domainRepository.getState();
      const archive = serializeArchive(exportInvestigation(state, investigation.id));
      if (Platform.OS === "web") {
        const blob = new Blob([archive], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `${item.title.replace(/[^\p{L}\p{N}]+/gu, "-") || "pumprca"}.pumprca`;
        anchor.click(); URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}pumprca-${item.id}.pumprca`;
        await FileSystem.writeAsStringAsync(uri, archive);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Экспорт Надёжкин" });
        else Alert.alert("Экспорт завершён", uri);
      }
    } catch (error) { Alert.alert("Не удалось экспортировать расследование", error instanceof Error ? error.message : "Проверьте данные кейса."); }
  };

  const workflowInvestigation = selectedCase ? domainInvestigations[selectedCase.id] : undefined;
  const workflowStatus = workflowInvestigation?.status ?? "DRAFT";
  const workflowTransitions = getAllowedTransitions(workflowStatus);
  const workflowProgress = getStatusProgress(workflowStatus);

  if (!selectedCase) return <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}><View style={styles.appFrame}>{(isDesktop || compactNavOpen) && <ReliabilitySidebar colors={colors} router={router} compact={!isDesktop} onToggle={() => setCompactNavOpen(false)} />}<View style={styles.appSurface}><View style={[styles.mobileTopbar, { borderBottomColor: colors.border }]}><Pressable onPress={() => setCompactNavOpen(true)}><Icon name="menu" size={24} color={colors.foreground} /></Pressable><Text style={[styles.mobileTopbarTitle, { color: colors.foreground }]}>Центр надёжности</Text><View style={styles.topbarStatus}><View style={styles.onlineDot} /><Text style={styles.topbarStatusText}>ОНЛАЙН</Text></View></View><View style={[styles.header, { borderBottomColor: colors.border }]}><View><Text style={[styles.eyebrow, { color: colors.primary }]}>ЦЕНТР НАДЁЖНОСТИ</Text><Text style={[styles.title, { color: colors.foreground }]}>Расследования отказов</Text></View></View><View style={styles.emptyState}><Icon name="folder-open" size={42} color={colors.muted} /><Text style={[styles.emptyStateTitle, { color: colors.foreground }]}>Расследований пока нет</Text><Text style={[styles.emptyStateText, { color: colors.muted }]}>Создайте новое расследование, чтобы собрать материалы и запустить анализ причин.</Text><Pressable onPress={openNewCase} style={[styles.createButton, { backgroundColor: colors.primary, paddingHorizontal: 20 }]}><Icon name="add" size={20} color="#FFFFFF" /><Text style={styles.createButtonText}>Новое расследование</Text></Pressable></View></View></View></ScreenContainer>;

  return (
    <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
      <View style={styles.appFrame}>
      {(isDesktop || compactNavOpen) && <ReliabilitySidebar colors={colors} router={router} compact={!isDesktop} onToggle={() => setCompactNavOpen(false)} />}
      <View style={styles.appSurface}>
      <View style={[styles.mobileTopbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => setCompactNavOpen(true)} style={styles.menuButton}><Icon name="menu" size={24} color={colors.foreground} /></Pressable>
        <View style={{ flex: 1 }}><Text style={[styles.mobileTopbarTitle, { color: colors.foreground }]}>Центр надёжности</Text><Text style={[styles.mobileTopbarSubtitle, { color: colors.muted }]}>Насосное оборудование · рабочее пространство</Text></View>
        <View style={styles.topbarStatus}><View style={styles.onlineDot} /><Text style={styles.topbarStatusText}>ОНЛАЙН</Text></View>
      </View>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>НАДЁЖКИН · ПОЛЕВОЙ РЕЖИМ</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Центр надёжности</Text>
          <Text style={[styles.headerSubtitle, { color: colors.muted }]}>Пульт надёжности насосного оборудования</Text>
        </View>
        <Pressable onPress={() => Alert.alert("Надёжкин", "Собирайте свидетельства на месте, а затем запускайте RCA-анализ по цепочке событий и барьерам.")} style={({ pressed }) => [styles.infoButton, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}>
          <Icon name="info-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.dashboardIntro, !isDesktop && styles.dashboardIntroMobile]}><View style={{ flex: 1 }}><Text style={[styles.dashboardKicker, { color: colors.primary }]}>ОБЗОР СМЕНЫ · {dashboardDate}</Text><Text style={[styles.dashboardTitle, { color: colors.foreground }]}>{user?.name ? `Добрый день, ${user.name.split(" ")[0]}!` : "Сводка по надёжности"}</Text><Text style={[styles.dashboardSubtitle, { color: colors.muted }]}>Расследования и состояние оборудования — на одном экране.</Text></View><Pressable onPress={openNewCase} style={({ pressed }) => [styles.primaryCta, { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 }]}><Icon name="add" size={19} color="#11181D" /><Text style={styles.primaryCtaText}>Новое расследование</Text></Pressable></View>

        <View style={[styles.kpiRow, !isDesktop && styles.kpiRowMobile]}>
          <View style={[styles.kpiCard, !isDesktop && styles.kpiCardMobile, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.foreground }]}>{cases.length}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>всего кейсов</Text></View>
          <View style={[styles.kpiCard, !isDesktop && styles.kpiCardMobile, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.warning }]}>{openCount}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>активные расследования</Text></View>
          <View style={[styles.kpiCard, !isDesktop && styles.kpiCardMobile, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.kpiNumber, { color: colors.success }]}>{completedCount}</Text><Text style={[styles.kpiLabel, { color: colors.muted }]}>с выводом анализа</Text></View>
          <View style={[styles.kpiCard, styles.kpiAccentCard, !isDesktop && styles.kpiCardMobile, { backgroundColor: "#222D33", borderColor: "#3B4A52" }]}><Text style={[styles.kpiNumber, { color: colors.primary }]}>{dashboardMetrics.critical}</Text><Text style={[styles.kpiLabel, { color: "#AEBBC2" }]}>критические события</Text></View>
        </View>

        <View style={[styles.dashboardGrid, !isDesktop && styles.dashboardGridMobile]}><View style={[styles.statusPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.panelHeading}><View><Text style={[styles.panelTitle, { color: colors.foreground }]}>Состояние оборудования</Text><Text style={[styles.panelSubtitle, { color: colors.muted }]}>Нажмите категорию для перехода к оборудованию</Text></View><Icon name="monitor-heart" size={21} color={colors.primary} /></View><View style={styles.statusRows}><StatusRow label="В работе" value={String(equipmentMetrics.active)} tone={colors.warning} total={Math.max(equipmentMetrics.total, 1)} onPress={() => router.push({ pathname: "./pumps", params: { filter: "В работе" } })} /><StatusRow label="Готово к эксплуатации" value={String(equipmentMetrics.ready)} tone={colors.success} total={Math.max(equipmentMetrics.total, 1)} onPress={() => router.push({ pathname: "./pumps", params: { filter: "Готово к эксплуатации" } })} /><StatusRow label="Требует внимания" value={String(equipmentMetrics.attention)} tone={colors.primary} total={Math.max(equipmentMetrics.total, 1)} onPress={() => router.push({ pathname: "./pumps", params: { filter: "Требует внимания" } })} /></View></View><View style={[styles.quickPanel, { backgroundColor: "#1A252B", borderColor: "#33434B" }]}><Text style={[styles.panelTitle, { color: "#F4F7F8" }]}>Быстрые действия</Text><Text style={[styles.panelSubtitle, { color: "#9AAAB3" }]}>Частые операции инженера</Text><View style={styles.quickActions}><QuickAction label="Добавить материалы" icon="add-photo-alternate" onPress={openNewCase} color={colors.primary} /><QuickAction label="Реестр оборудования" icon="settings-input-component" onPress={() => router.push("./pumps" as never)} color="#86B7C7" /><QuickAction label="ИИ и кэш" icon="auto-awesome" onPress={() => router.push("./usage" as never)} color="#B79BE8" /></View></View></View>

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
              <View style={styles.caseBottomLine}><Pill background={item.status === "Готово" ? "#E5F5EF" : "#3A2D12"} color={item.status === "Готово" ? "#16805D" : "#FFC85A"}>{item.status}</Pill><Text style={[styles.updatedText, { color: colors.muted }]}>{item.updatedAt}</Text><Text style={[styles.evidenceCount, { color: colors.foreground }]}><Icon name="attach-file" size={15} color={colors.muted} /> {item.evidence.length}</Text></View>
            </Pressable>
          )}
        />

        <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.detailHeader}><View style={{ flex: 1 }}><Text style={[styles.detailEyebrow, { color: colors.primary }]}>АКТИВНОЕ РАССЛЕДОВАНИЕ</Text><Text style={[styles.detailTitle, { color: colors.foreground }]}>{selectedCase.title}</Text></View><Pill background={selectedCase.severity === "Высокий" ? "#102E5A" : "#3A2D12"} color={selectedCase.severity === "Высокий" ? "#FF7182" : "#FFC85A"}>{selectedCase.severity}</Pill></View>
          <View style={[styles.workflowCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.workflowHeader}><View style={{ flex: 1 }}><Text style={[styles.detailEyebrow, { color: colors.primary }]}>ЭТАПЫ РАССЛЕДОВАНИЯ</Text><Text style={[styles.workflowStatus, { color: colors.foreground }]}>{getStatusLabel(workflowStatus)}</Text></View><Text style={[styles.workflowProgressText, { color: colors.primary }]}>{workflowProgress}%</Text></View>
            <View style={[styles.workflowTrack, { backgroundColor: colors.border }]}><View style={[styles.workflowFill, { width: `${workflowProgress}%`, backgroundColor: colors.primary }]} /></View>
            <View style={styles.workflowActions}>{workflowTransitions.map((transition) => <Pressable key={`${transition.from}-${transition.to}`} onPress={() => requestWorkflowTransition(selectedCase, transition)} style={({ pressed }) => [styles.workflowButton, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.72 : 1 }]}><Text style={[styles.workflowButtonText, { color: colors.foreground }]}>{transition.label}</Text></Pressable>)}</View>
            {auditEvents.length > 0 && <View style={styles.auditList}><Text style={[styles.auditTitle, { color: colors.muted }]}>ИСТОРИЯ СТАТУСА</Text>{auditEvents.slice(-3).reverse().map((event) => <Text key={event.id} numberOfLines={2} style={[styles.auditText, { color: colors.muted }]}>{event.oldValue ? `${getStatusLabel(event.oldValue as InvestigationStatus)} → ${getStatusLabel(event.newValue as InvestigationStatus)}` : event.action}{event.comment ? ` · ${event.comment}` : ""}</Text>)}</View>}
          </View>
          <Text style={[styles.detailNarrative, { color: colors.muted }]}>{selectedCase.narrative}</Text>
          <View style={styles.factGrid}><View><Text style={[styles.factLabel, { color: colors.muted }]}>Оборудование</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{selectedCase.equipmentType}</Text></View><View><Text style={[styles.factLabel, { color: colors.muted }]}>Локация</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{selectedCase.location}</Text></View></View>
          {isAnalyzing && <View style={[styles.analysisStatus, { backgroundColor: colors.background, borderColor: colors.border }]}><View style={{ flex: 1 }}><Text style={[styles.analysisStatusTitle, { color: colors.foreground }]}>{analysisPhase || "Запускаю серверный анализ…"}</Text>{analysisFrame ? <Text numberOfLines={1} style={[styles.analysisStatusText, { color: colors.muted }]}>Кадр: {analysisFrame}</Text> : null}</View><Pressable onPress={() => { analysisCancelled.current = true; }} style={({ pressed }) => [styles.cancelAnalysis, { borderColor: colors.error, opacity: pressed ? 0.7 : 1 }]}><Text style={[styles.cancelAnalysisText, { color: colors.error }]}>Отмена</Text></Pressable></View>}
          {!isAnalyzing && analysisError ? <Text style={[styles.analysisError, { color: colors.error }]} numberOfLines={3}>{analysisError}</Text> : null}
          <View style={styles.detailActions}><ActionButton label="Рабочая область" icon="dashboard" onPress={() => router.push({ pathname: "./workspace", params: { id: selectedCase.id } })} colors={colors} primary /><ActionButton label="Добавить материалы" icon="add-photo-alternate" onPress={() => openEvidenceEditor(selectedCase)} colors={colors} /><ActionButton label={isAnalyzing ? "Анализирую…" : "Запустить анализ"} icon={isAnalyzing ? "hourglass-top" : "auto-awesome"} onPress={() => analyzeCase(selectedCase)} colors={colors} primary={selectedCase.evidence.length > 0} disabled={isAnalyzing} /><ActionButton label="Только сохранённое" icon="cached" onPress={() => analyzeCase(selectedCase, true)} colors={colors} disabled={isAnalyzing} /><ActionButton label="Экспорт файла" icon="archive" onPress={() => exportPumprca(selectedCase)} colors={colors} /><Pressable onPress={() => confirmDeleteCase(selectedCase)} style={({ pressed }) => [styles.deleteButton, { borderColor: colors.error, opacity: pressed ? 0.72 : 1 }]}><Icon name="delete-outline" size={18} color={colors.error} /><Text style={[styles.deleteButtonText, { color: colors.error }]}>Удалить</Text></Pressable></View>
        </View>

        <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Материалы расследования</Text><Text style={[styles.sectionSubtitle, { color: colors.muted }]}>{selectedCase.evidence.length} источника в кейсе</Text></View><Icon name="folder-open" size={22} color={colors.muted} /></View>
        <View style={styles.evidenceList}>{selectedCase.evidence.map((item) => <View key={item.id} style={[styles.evidenceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.evidenceIcon, { backgroundColor: item.kind === "photo" ? "#E7F0FF" : item.kind === "video" ? "#F2E9FF" : "#E5F5EF" }]}><Icon name={item.kind === "photo" ? "image" : item.kind === "video" ? "videocam" : item.kind === "file" ? "description" : "notes"} size={20} color={item.kind === "photo" ? "#3867D6" : item.kind === "video" ? "#8656C7" : "#16805D"} /></View><View style={{ flex: 1 }}><Text style={[styles.evidenceName, { color: colors.foreground }]}>{item.name}</Text><Text numberOfLines={1} style={[styles.evidenceNote, { color: colors.muted }]}>{item.note ?? (item.kind === "video" ? "Видеосвидетельство · будет взят кадр для AI-анализа" : item.annotations?.length ? `${item.annotations.length} маркеров повреждений` : "Добавлено в материалы кейса")}</Text></View>{item.kind === "photo" && <Pressable onPress={() => { setEditingId(selectedCase.id); setDraftEvidence(selectedCase.evidence); setAnnotationTarget(item); }} style={styles.annotateSmall}><Icon name="edit" size={16} color={colors.primary} /></Pressable>}<Icon name="check-circle" size={19} color={colors.success} /></View>)}</View>

          {selectedCase.result ? <RcaSummaryBoundary colors={colors} onReset={() => updateCase({ ...selectedCase, result: undefined, status: "В работе", updatedAt: formatNow() })}><RcaSummary result={selectedCase.result} colors={colors} onExport={() => exportRcaReport(selectedCase)} isExporting={isExporting} /></RcaSummaryBoundary> : <View style={[styles.emptyRca, { backgroundColor: "#242424", borderColor: "#3A3A3A" }]}><View style={styles.emptyRcaIcon}><Icon name="auto-awesome" size={24} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.emptyRcaTitle, { color: colors.foreground }]}>Вывод анализа ещё не сформирован</Text><Text style={[styles.emptyRcaText, { color: colors.muted }]}>Добавьте факты, фотографии и видео. Затем сервер выполнит проверяемый анализ по бесплатному маршруту.</Text></View></View>}
      </ScrollView>

      <Modal visible={showNewCase} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewCase(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}><View><Text style={[styles.modalEyebrow, { color: colors.primary }]}>{editingId ? "ДОПОЛНИТЬ КЕЙС" : "НОВОЕ РАССЛЕДОВАНИЕ"}</Text><Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingId ? "Обновить материалы" : "Собрать кейс"}</Text></View><Pressable onPress={() => setShowNewCase(false)} style={[styles.closeButton, { backgroundColor: colors.surface }]}><Icon name="close" size={21} color={colors.foreground} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Название отказа</Text><TextInput value={draft.title} onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))} placeholder="Например: разрушение торцевого уплотнения" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Группа оборудования</Text>
            <View style={[styles.caseEquipmentPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.stepLabel, { color: colors.muted }]}>1. Сначала выберите класс оборудования</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.caseClassRow}>
                {CASE_EQUIPMENT_CLASSES.map((item) => {
                  const active = selectedEquipmentClass === item.id;
                  return <Pressable key={item.id} onPress={() => { setSelectedEquipmentClass(item.id); setDraft((current) => ({ ...current, equipmentType: caseEquipmentModels(item.id)[0]?.model ?? current.equipmentType })); setEquipmentSearch(""); }} style={({ pressed }) => [styles.caseClassCard, { backgroundColor: active ? "#153A70" : colors.background, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.78 : 1 }]}>
                    <Icon name={item.icon} size={21} color={active ? colors.primary : colors.muted} />
                    <Text numberOfLines={2} style={[styles.caseClassTitle, { color: active ? colors.primary : colors.foreground }]}>{item.label}</Text>
                  </Pressable>;
                })}
              </ScrollView>
              <Text style={[styles.classDescription, { color: colors.muted }]}>{CASE_EQUIPMENT_CLASSES.find((item) => item.id === selectedEquipmentClass)?.description}</Text>
              <Text style={[styles.stepLabel, { color: colors.muted }]}>2. Выберите конкретную модель или тип</Text>
              <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.background }]}><Icon name="search" size={18} color={colors.muted} /><TextInput value={equipmentSearch} onChangeText={setEquipmentSearch} placeholder="Поиск модели, например компрессор" placeholderTextColor={colors.muted} style={[styles.searchInput, { color: colors.foreground }]} /></View>
              <View style={styles.caseModelList}>
                {caseModels.slice(0, 40).map((entry) => {
                  const active = draft.equipmentType === entry.model;
                  return <Pressable key={`${entry.groupId}-${entry.model}`} onPress={() => setDraft((current) => ({ ...current, equipmentType: entry.model }))} style={({ pressed }) => [styles.caseModelCard, { backgroundColor: active ? "#153A70" : colors.background, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.78 : 1 }]}>
                    <View style={{ flex: 1 }}><Text style={[styles.caseModelTitle, { color: active ? "#8CC2FF" : colors.foreground }]}>{entry.model}</Text><Text style={[styles.caseModelDescription, { color: colors.muted }]}>{entry.description}</Text><View style={styles.capabilityRow}>{entry.capabilities.slice(0, 3).map((capability) => <View key={capability} style={[styles.capabilityPill, { backgroundColor: active ? "#204B86" : colors.surface }]}><Text style={[styles.capabilityText, { color: colors.muted }]}>{capability}</Text></View>)}</View></View>{active && <Icon name="check-circle" size={21} color="#8CC2FF" />}</Pressable>;
                })}
              </View>
              {!caseModels.length && <Text style={[styles.noEquipmentText, { color: colors.muted }]}>Ничего не найдено. Измените поиск или выберите другую группу.</Text>}
              {selectedCaseModel && <View style={styles.selectedEquipmentNote}><Icon name="check-circle" size={18} color={colors.success} /><Text style={{ color: colors.foreground, fontWeight: "800", flex: 1 }}>Выбрано: {selectedCaseModel.model}</Text></View>}
            </View>
            <View style={styles.twoInputs}><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: colors.foreground }]}>Тег актива</Text><TextInput value={draft.assetTag} onChangeText={(value) => setDraft((current) => ({ ...current, assetTag: value }))} placeholder="P-204" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /></View><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: colors.foreground }]}>Локация</Text><TextInput value={draft.location} onChangeText={(value) => setDraft((current) => ({ ...current, location: value }))} placeholder="Цех 2" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /></View></View>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Что произошло?</Text><TextInput value={draft.narrative} onChangeText={(value) => setDraft((current) => ({ ...current, narrative: value }))} placeholder="Опишите события, симптомы и действия оператора…" placeholderTextColor={colors.muted} multiline numberOfLines={5} textAlignVertical="top" style={[styles.input, styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Теги кейса</Text><View style={styles.textEvidenceRow}><TextInput value={tagInput} onChangeText={setTagInput} onSubmitEditing={addDraftTag} placeholder="например: вибрация" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="done" /><Pressable onPress={addDraftTag} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="add" size={20} color="#FFFFFF" /></Pressable></View>
            {draftTags.length > 0 && <View style={styles.tagInputList}>{draftTags.map((tag) => <Pressable key={tag} onPress={() => setDraftTags((current) => current.filter((entry) => entry !== tag))} style={[styles.formTag, { backgroundColor: "#102E5A" }]}><Text style={[styles.formTagText, { color: colors.primary }]}>#{tag}</Text><Icon name="close" size={13} color={colors.primary} /></Pressable>)}</View>}
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Свидетельства</Text><View style={styles.evidenceButtons}><EvidenceButton label="Фото" icon="photo-camera" onPress={() => pickMedia("camera")} colors={colors} /><EvidenceButton label="Галерея" icon="photo-library" onPress={() => pickMedia("gallery")} colors={colors} /><EvidenceButton label="Видео" icon="videocam" onPress={() => pickMedia("video")} colors={colors} /><EvidenceButton label="Файл" icon="attach-file" onPress={pickFile} colors={colors} /></View>
            <View style={styles.textEvidenceRow}><TextInput value={textEvidence} onChangeText={setTextEvidence} placeholder="Добавить показание, замер или факт…" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} /><Pressable onPress={addTextEvidence} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Icon name="arrow-upward" size={20} color="#FFFFFF" /></Pressable></View>
            {isPreparing && <View style={styles.loadingRow}><ActivityIndicator color={colors.primary} /><Text style={[styles.loadingText, { color: colors.muted }]}>Подготавливаю материалы…</Text></View>}
            {draftEvidence.length > 0 && <View style={styles.draftList}>{draftEvidence.map((item) => <View key={item.id} style={[styles.draftRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><Icon name={item.kind === "photo" ? "image" : item.kind === "video" ? "videocam" : item.kind === "file" ? "description" : "notes"} size={18} color={colors.primary} /><Text numberOfLines={1} style={[styles.draftName, { color: colors.foreground }]}>{item.name}</Text>{item.kind === "photo" && <Pressable onPress={() => setAnnotationTarget(item)} style={styles.annotateDraft}><Icon name="edit" size={17} color={colors.primary} /></Pressable>}<Pressable onPress={() => setDraftEvidence((current) => current.filter((entry) => entry.id !== item.id))}><Icon name="remove-circle-outline" size={18} color={colors.muted} /></Pressable></View>)}</View>}
            <Pressable onPress={createCase} style={({ pressed }) => [styles.createButton, { backgroundColor: colors.primary, opacity: pressed ? 0.86 : 1 }]}><Icon name="add-task" size={20} color="#FFFFFF" /><Text style={styles.createButtonText}>{editingId ? "Сохранить материалы" : "Сохранить расследование"}</Text></Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={Boolean(returnTarget)} transparent animationType="fade" onRequestClose={() => setReturnTarget(null)}>
        <View style={styles.reasonBackdrop}><View style={[styles.reasonCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.modalTitle, { color: colors.foreground }]}>Причина возврата</Text><Text style={[styles.detailNarrative, { color: colors.muted }]}>Укажите, что нужно доработать перед повторной проверкой.</Text><TextInput autoFocus value={returnReason} onChangeText={setReturnReason} multiline placeholder="Например: не хватает измерений вибрации…" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} /><View style={styles.reasonActions}><Pressable onPress={() => setReturnTarget(null)} style={[styles.workflowButton, { borderColor: colors.border }]}><Text style={[styles.workflowButtonText, { color: colors.muted }]}>Отмена</Text></Pressable><Pressable onPress={async () => { if (!returnTarget || !returnReason.trim()) return; const target = returnTarget; setReturnTarget(null); await performWorkflowTransition(selectedCase, target, returnReason); }} style={[styles.workflowButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={[styles.workflowButtonText, { color: "#FFFFFF" }]}>Вернуть</Text></Pressable></View></View></View>
      </Modal>
      <PhotoAnnotationEditor visible={Boolean(annotationTarget)} uri={annotationTarget?.uri} fileName={annotationTarget?.name ?? "Фото"} annotations={annotationTarget?.annotations ?? []} onSave={savePhotoAnnotations} onClose={() => setAnnotationTarget(null)} />
      </View>
      </View>
    </ScreenContainer>
  );
}

function StatusRow({ label, value, tone, total, onPress }: { label: string; value: string; tone: string; total: number; onPress?: () => void }) {
  const width = `${Math.min(100, Math.max(8, (Number(value) / total) * 100))}%` as `${number}%`;
  return <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.statusRow, pressed && { opacity: 0.72 }]}><View style={styles.statusRowTop}><Text style={styles.statusLabel}>{label}</Text><Text style={[styles.statusValue, { color: tone }]}>{value}</Text></View><View style={styles.statusTrack}><View style={[styles.statusFill, { width, backgroundColor: tone }]} /></View></Pressable>;
}

function QuickAction({ label, icon, onPress, color }: { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; onPress: () => void; color: string }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.quickAction, { opacity: pressed ? 0.72 : 1 }]}><View style={[styles.quickIcon, { backgroundColor: `${color}22` }]}><Icon name={icon} size={19} color={color} /></View><Text style={styles.quickActionText} numberOfLines={2}>{label}</Text></Pressable>;
}

function EquipmentChip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 }]}><Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>{label}</Text></Pressable>;
}

function FilterChip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.filterChip, { backgroundColor: active ? "#102E5A" : colors.background, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.78 : 1 }]}><Text style={[styles.filterChipText, { color: active ? colors.primary : colors.muted }]}>{label}</Text></Pressable>;
}

function EvidenceButton({ label, icon, onPress, colors }: { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.evidenceButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}><Icon name={icon} size={20} color={colors.primary} /><Text style={[styles.evidenceButtonText, { color: colors.foreground }]}>{label}</Text></Pressable>;
}

function RcaSummary({ result, colors, onExport, isExporting }: { result: RcaResult; colors: ReturnType<typeof useColors>; onExport: () => void; isExporting: boolean }) {
  const confidenceBand = getConfidenceBand(result.confidence);
  const confidenceLabel = formatConfidenceLabel(confidenceBand);
  const blocks = [
    { number: "1", label: "Физическая причина", value: result.physicalCause },
    { number: "2", label: "Человеческий фактор", value: result.humanFactor },
    { number: "3", label: "Системная причина", value: result.systemicCause },
  ];
  return <View style={styles.resultStack}>
    <View style={[styles.rcaCard, { backgroundColor: "#1E1E1E" }]}>
      <View style={styles.rcaHeader}><View><Text style={styles.rcaEyebrow}>AI RCA / ВЫВОДЫ</Text><Text style={styles.rcaTitle}>Структурированный анализ</Text></View><View style={styles.confidence}><Text style={styles.confidenceNumber}>{result.confidence}%</Text><Text style={styles.confidenceLabel}>{confidenceLabel}</Text></View></View>
      <Text style={styles.rcaSummaryText}>{result.executiveSummary}</Text>
      <View style={styles.analysisBlock}><View style={styles.blockHeading}><View style={styles.blockNumber}><Text style={styles.blockNumberText}>0</Text></View><Text style={styles.blockTitle}>Классификация доказательств</Text></View><Text style={styles.structuredLabel}>ФАКТЫ</Text>{result.structuredRca.facts.length ? result.structuredRca.facts.map((fact, index) => <Text key={`fact-${index}`} style={styles.structuredLine}>[{index}] {fact.statement} · {formatEvidenceSource(fact.source)} · ссылки: {fact.evidenceRefs.join(", ")}</Text>) : <Text style={styles.structuredMuted}>Факты не выделены.</Text>}<Text style={styles.structuredLabel}>СИМПТОМЫ</Text>{result.structuredRca.symptoms.length ? result.structuredRca.symptoms.map((symptom, index) => <Text key={`symptom-${index}`} style={styles.structuredLine}>• {symptom.statement} · ссылки: {symptom.evidenceRefs.join(", ")}</Text>) : <Text style={styles.structuredMuted}>Симптомы не выделены.</Text>}<Text style={styles.structuredLabel}>ГИПОТЕЗЫ</Text>{result.structuredRca.hypotheses.length ? result.structuredRca.hypotheses.map((hypothesis, index) => <Text key={`hypothesis-${index}`} style={styles.structuredLine}>• {hypothesis.statement} · факты [{hypothesis.supportingFactIndexes.join(", ")}] · {formatHypothesisStatus(hypothesis.status)} · {hypothesis.confidence}%</Text>) : <Text style={styles.structuredMuted}>Гипотезы не сформированы.</Text>}<Text style={styles.structuredLabel}>НЕДОСТАЮЩИЕ ДАННЫЕ</Text>{result.structuredRca.missingData.length ? result.structuredRca.missingData.map((missing, index) => <Text key={`missing-${index}`} style={styles.structuredLine}>• {missing}</Text>) : <Text style={styles.structuredMuted}>Критические пропуски не указаны.</Text>}</View>
      {blocks.map((block) => <View key={block.number} style={styles.analysisBlock}><View style={styles.blockHeading}><View style={styles.blockNumber}><Text style={styles.blockNumberText}>{block.number}</Text></View><Text style={styles.blockTitle}>{block.label}</Text></View><Text style={styles.blockText}>{block.value}</Text></View>)}
      <View style={styles.analysisBlock}><View style={styles.blockHeading}><View style={styles.blockNumber}><Text style={styles.blockNumberText}>4</Text></View><Text style={styles.blockTitle}>Мероприятия SMART</Text></View>{result.smartActions.map((action, index) => <View key={`${action.priority}-${index}`} style={styles.smartAction}><View style={styles.smartTop}><Text style={styles.recommendationBadgeText}>{formatPriority(action.priority)}</Text><Text style={styles.smartActionTitle}>{action.specific}</Text></View><Text style={styles.smartLine}><Text style={styles.smartKey}>S</Text> {action.specific}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>M</Text> {action.measurable}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>A</Text> {action.achievable}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>R</Text> {action.relevant}</Text><Text style={styles.smartLine}><Text style={styles.smartKey}>T</Text> {action.timeBound}</Text></View>)}</View>
      <View style={styles.openQuestions}><Icon name="help-outline" size={19} color="#8CC2FF" /><Text style={styles.openQuestionsText}>{result.openQuestions.length} открытых вопроса требуют проверки на месте</Text></View><Pressable disabled={isExporting} onPress={onExport} style={({ pressed }) => [styles.pdfButton, { opacity: isExporting ? 0.55 : pressed ? 0.8 : 1 }]}><Icon name={isExporting ? "hourglass-top" : "picture-as-pdf"} size={18} color="#FFFFFF" /><Text style={styles.pdfButtonText}>{isExporting ? "Формирую PDF…" : "Экспортировать RCA в PDF"}</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  appFrame: { flex: 1, flexDirection: "row", minHeight: 0 },
  appSurface: { flex: 1, minWidth: 0 },
  sidebar: { width: 232, borderRightWidth: 1, paddingHorizontal: 14, paddingTop: 20, paddingBottom: 18 },
  sidebarCompact: { position: "absolute", zIndex: 30, left: 0, top: 0, bottom: 0, width: 250, elevation: 12, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 8, height: 0 } },
  brandBlock: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, marginBottom: 30 },
  brandMark: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  brandName: { color: "#F4F7F8", fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },
  brandCaption: { color: "#7F919A", fontSize: 8, fontWeight: "800", letterSpacing: 1.2, marginTop: 3 },
  navCaption: { color: "#63757E", fontSize: 9, fontWeight: "900", letterSpacing: 1.4, paddingHorizontal: 8, marginBottom: 8 },
  navList: { gap: 4 },
  navItem: { minHeight: 42, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10 },
  navItemActive: { backgroundColor: "#252E33", borderLeftWidth: 2, borderLeftColor: "#2F8CFF" },
  navText: { fontSize: 12, fontWeight: "700" },
  sidebarFooter: { marginTop: "auto", gap: 5 },
  offlineBadge: { marginTop: 16, minHeight: 30, borderRadius: 8, backgroundColor: "#1B342E", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#59D6A8" },
  offlineText: { color: "#7DE1BE", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  sidebarClose: { marginLeft: "auto", padding: 6 },
  mobileTopbar: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  menuButton: { padding: 4 },
  mobileTopbarTitle: { fontSize: 13, fontWeight: "800" },
  mobileTopbarSubtitle: { fontSize: 10, marginTop: 2 },
  topbarStatus: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1B342E", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  topbarStatusText: { color: "#7DE1BE", fontSize: 8, fontWeight: "900" },
  headerSubtitle: { color: "#84949D", fontSize: 11, marginTop: 5 },
  dashboardIntro: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  dashboardIntroMobile: { flexDirection: "column", alignItems: "stretch", gap: 12 },
  dashboardKicker: { fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginBottom: 6 },
  dashboardTitle: { fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  dashboardSubtitle: { fontSize: 12, marginTop: 5 },
  primaryCta: { minHeight: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 13 },
  primaryCtaText: { color: "#11181D", fontSize: 11, fontWeight: "900", flexShrink: 1, textAlign: "center" },
  kpiAccentCard: { minWidth: 0 },
  kpiRowMobile: { flexDirection: "row", flexWrap: "wrap" },
  kpiCardMobile: { flex: 0, flexGrow: 0, flexShrink: 0, flexBasis: "48%", width: "48%", maxWidth: "48%", minWidth: "48%", minHeight: 78 },
  dashboardGrid: { flexDirection: "row", gap: 12 },
  dashboardGridMobile: { flexDirection: "column" },
  statusPanel: { flex: 1.4, borderWidth: 1, borderRadius: 16, padding: 15, gap: 16 },
  quickPanel: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 15, gap: 12 },
  panelHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  panelTitle: { fontSize: 14, fontWeight: "900" },
  panelSubtitle: { fontSize: 10, marginTop: 4 },
  statusRows: { gap: 13 },
  statusRow: { gap: 6 },
  statusRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusLabel: { color: "#A4B1B8", fontSize: 11, fontWeight: "700" },
  statusValue: { fontSize: 13, fontWeight: "900" },
  statusTrack: { height: 5, borderRadius: 3, backgroundColor: "#2B3940", overflow: "hidden" },
  statusFill: { height: 5, borderRadius: 3 },
  quickActions: { flexDirection: "row", gap: 7 },
  quickAction: { flex: 1, minHeight: 65, borderRadius: 11, backgroundColor: "#102E5A", paddingVertical: 8, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", gap: 5 },
  quickIcon: { width: 31, height: 31, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  quickActionText: { color: "#E6EDF0", fontSize: 9, fontWeight: "800", textAlign: "center" },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 4 },
  title: { fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  infoButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 38, gap: 20 },
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
  caseIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#102E5A" },
  caseHeading: { flex: 1 },
  caseTitle: { fontSize: 15, fontWeight: "800" },
  caseMeta: { fontSize: 11, marginTop: 4 },
  tagRow: { flexDirection: "row", gap: 5, marginTop: 6, flexWrap: "wrap" },
  miniTag: { backgroundColor: "#102E5A", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
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
  detailActions: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 17 },
  actionButton: { minWidth: 140, minHeight: 46, flexGrow: 1, flexBasis: 140, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  actionButtonText: { fontSize: 12, lineHeight: 16, fontWeight: "800", flexShrink: 1, textAlign: "center" },
  evidenceList: { gap: 8 },
  evidenceRow: { borderWidth: 1, borderRadius: 15, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  evidenceIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  evidenceName: { fontSize: 13, fontWeight: "800" },
  evidenceNote: { fontSize: 11, marginTop: 3 },
  annotateSmall: { width: 29, height: 29, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#102E5A" },
  emptyRca: { borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: "row", gap: 13 },
  emptyRcaIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  emptyRcaTitle: { fontSize: 14, fontWeight: "800", marginBottom: 5 },
  emptyRcaText: { fontSize: 12, lineHeight: 18 },
  rcaCard: { borderRadius: 20, padding: 18, gap: 15 },
  rcaHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  rcaEyebrow: { color: "#8CC2FF", fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 4 },
  rcaTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  confidence: { alignItems: "flex-end" },
  confidenceNumber: { color: "#7BE4C0", fontSize: 21, fontWeight: "800" },
  confidenceLabel: { color: "#AEBBC7", fontSize: 10 },
  rcaSummaryText: { color: "#D7E0E6", fontSize: 13, lineHeight: 20 },
  rootCauseBlock: { borderLeftWidth: 3, borderLeftColor: "#1683F5", paddingLeft: 12, gap: 5 },
  rootCauseLabel: { color: "#8CC2FF", fontSize: 10, letterSpacing: 1.1, fontWeight: "800" },
  rootCauseText: { color: "#FFFFFF", fontSize: 14, lineHeight: 21, fontWeight: "700" },
  timeline: { gap: 10 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timelineDot: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: "#607483", alignItems: "center", justifyContent: "center" },
  timelineIndex: { color: "#AEBBC7", fontSize: 10, fontWeight: "800" },
  timelineText: { color: "#D7E0E6", fontSize: 12, flex: 1 },
  subsectionLabel: { color: "#AEBBC7", fontSize: 10, letterSpacing: 1.1, fontWeight: "800", textTransform: "uppercase" },
  recommendation: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  recommendationBadge: { borderRadius: 6, backgroundColor: "#5B2E25", paddingHorizontal: 7, paddingVertical: 4 },
  recommendationBadgeText: { color: "#8CC2FF", fontSize: 10, fontWeight: "800" },
  recommendationAction: { color: "#FFFFFF", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  recommendationMeta: { color: "#AEBBC7", fontSize: 10, marginTop: 3 },
  openQuestions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#405361", paddingTop: 14, flexDirection: "row", gap: 8, alignItems: "center" },
  openQuestionsText: { color: "#8CC2FF", fontSize: 11, fontWeight: "700" },
  pdfButton: { minHeight: 45, borderRadius: 12, backgroundColor: "#1683F5", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pdfButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  deleteButton: { minWidth: 104, minHeight: 44, borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center" },
  deleteButtonText: { fontSize: 11, fontWeight: "800" },
  analysisStatus: { minHeight: 52, borderRadius: 13, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  analysisStatusTitle: { fontSize: 12, fontWeight: "800" },
  analysisStatusText: { fontSize: 10, marginTop: 3 },
  cancelAnalysis: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  cancelAnalysisText: { fontSize: 11, fontWeight: "800" },
  analysisError: { fontSize: 10, lineHeight: 14, marginTop: -3 },
  workflowCard: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 10, marginTop: 12, marginBottom: 10 },
  workflowHeader: { flexDirection: "row", alignItems: "center" },
  workflowStatus: { fontSize: 14, fontWeight: "800", marginTop: 3 },
  workflowProgressText: { fontSize: 16, fontWeight: "900" },
  workflowTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  workflowFill: { height: 6, borderRadius: 3 },
  workflowActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  workflowButton: { minHeight: 38, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8, flexGrow: 1 },
  workflowButtonText: { fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center" },
  auditList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#405361", paddingTop: 9, gap: 4 },
  auditTitle: { fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  auditText: { fontSize: 10, lineHeight: 14 },
  analysisBlock: { borderTopWidth: 1, borderTopColor: "#3A3A3A", paddingTop: 13, gap: 7 },
  blockHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  blockNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#1683F5", alignItems: "center", justifyContent: "center" },
  blockNumberText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  blockTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  blockText: { color: "#F2F4F5", fontSize: 13, lineHeight: 20 },
  structuredLabel: { color: "#FF9A73", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginTop: 5 },
  structuredLine: { color: "#DCE4E7", fontSize: 11, lineHeight: 17 },
  structuredMuted: { color: "#82939B", fontSize: 11, lineHeight: 17 },
  smartAction: { backgroundColor: "#2A2A2A", borderRadius: 10, padding: 11, gap: 5 },
  smartTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  smartActionTitle: { color: "#FFFFFF", fontSize: 12, lineHeight: 17, fontWeight: "700", flex: 1 },
  smartLine: { color: "#E5E7E9", fontSize: 11, lineHeight: 16 },
  smartKey: { color: "#8CC2FF", fontWeight: "800" },
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
  caseEquipmentPanel: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 9 },
  stepLabel: { fontSize: 11, fontWeight: "800", marginTop: 1 },
  caseClassRow: { gap: 8, paddingRight: 4 },
  caseClassCard: { width: 148, minHeight: 74, borderWidth: 1, borderRadius: 13, padding: 11, justifyContent: "space-between", gap: 6 },
  caseClassTitle: { fontSize: 11, lineHeight: 14, fontWeight: "800" },
  classDescription: { fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  caseModelList: { gap: 7 },
  caseModelCard: { minHeight: 82, borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  caseModelTitle: { fontSize: 14, fontWeight: "800", marginBottom: 4 },
  caseModelDescription: { fontSize: 11, lineHeight: 15 },
  capabilityRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  capabilityPill: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  capabilityText: { fontSize: 9, fontWeight: "700" },
  selectedEquipmentNote: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 3 },
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
  annotateDraft: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#102E5A" },
  createButton: { minHeight: 51, borderRadius: 15, marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  createButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  emptyStateTitle: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  emptyStateText: { fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 360 },
  reasonBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 20 },
  reasonCard: { width: "100%", maxWidth: 520, borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  reasonActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 2 },
});
