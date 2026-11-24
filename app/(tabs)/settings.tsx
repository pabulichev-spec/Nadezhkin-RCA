import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { clearAiCache, getAllowedCacheTtlDays, getCacheTtlDays, setCacheTtlDays, type CacheTtlDays } from "@/lib/ai-cache";
import { PumpRcaRepository } from "@/lib/domain-repository";
import { makeBackup, restoreBackup } from "@/lib/pumprca-transfer";
import { startOAuthLogin } from "@/constants/oauth";

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading, logout } = useAuth();
  const repo = useMemo(() => new PumpRcaRepository(), []);
  const [ttl, setTtl] = useState<CacheTtlDays>(7);
  const [counts, setCounts] = useState({ pumps: 0, investigations: 0, evidence: 0 });

  const loadSummary = async () => {
    const [nextTtl, state] = await Promise.all([getCacheTtlDays(), repo.getState()]);
    setTtl(nextTtl);
    setCounts({ pumps: state.pumps.length, investigations: state.investigations.length, evidence: state.evidence.length });
  };

  useEffect(() => {
    void loadSummary();
    // Repository summary is intentionally loaded once when the profile screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = (name: string, text: string) => {
    if (Platform.OS !== "web") return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const backup = async () => {
    const raw = makeBackup(await repo.getState());
    if (Platform.OS === "web") {
      download("nadezhkin-backup.json", raw);
      return;
    }
    const uri = `${FileSystem.cacheDirectory}nadezhkin-backup.json`;
    await FileSystem.writeAsStringAsync(uri, raw);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json" });
  };

  const restore = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain"], copyToCacheDirectory: true });
    if (result.canceled) return;
    try {
      const raw = await FileSystem.readAsStringAsync(result.assets[0].uri);
      await repo.save(restoreBackup(raw));
      await loadSummary();
      Alert.alert("Готово", "Резервная копия восстановлена. Перейдите в раздел кейсов, чтобы увидеть обновлённые данные.");
    } catch (error) {
      Alert.alert("Восстановление не выполнено", error instanceof Error ? error.message : "Файл резервной копии повреждён");
    }
  };

  const confirmLogout = () => Alert.alert("Выйти из профиля?", "Локальные расследования останутся на устройстве.", [
    { text: "Отмена", style: "cancel" },
    { text: "Выйти", style: "destructive", onPress: () => void logout() },
  ]);

  const login = async () => {
    try {
      await startOAuthLogin();
    } catch (error) {
      Alert.alert("Вход не выполнен", error instanceof Error ? error.message : "Не удалось открыть окно авторизации.");
    }
  };

  return (
    <ScreenContainer containerClassName="bg-background" edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.topbar, { borderBottomColor: colors.border }]}><Pressable onPress={() => router.back()} style={styles.topbarBack}><MaterialIcons name="arrow-back" size={21} color={colors.primary} /></Pressable><Text style={[styles.topbarTitle, { color: colors.foreground }]}>Профиль и настройки</Text><MaterialIcons name="notifications-none" size={21} color={colors.foreground} /></View>
        <View style={styles.heading}>
          <View>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>НАДЁЖКИН · ПРОФИЛЬ</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Профиль и настройки</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Рабочее пространство инженера по надёжности.</Text>
          </View>
          <View style={[styles.headerIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MaterialIcons name="person" size={24} color={colors.primary} />
          </View>
        </View>

        <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{user?.name?.trim()?.slice(0, 1)?.toUpperCase() || "Н"}</Text>
          </View>
          <View style={styles.profileDetails}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>{user?.name || "Локальный профиль"}</Text>
            <Text style={[styles.profileEmail, { color: colors.muted }]}>{user?.email || "Данные пользователя появятся после авторизации"}</Text>
            <View style={[styles.connectionBadge, { backgroundColor: isAuthenticated ? "#123B32" : "#26354A" }]}>
              <View style={[styles.connectionDot, { backgroundColor: isAuthenticated ? colors.success : colors.warning }]} />
              <Text style={[styles.connectionText, { color: isAuthenticated ? colors.success : colors.warning }]}>{isAuthenticated ? "Синхронизация включена" : "Только устройство"}</Text>
            </View>
          </View>
        </View>

        {!isAuthenticated && <View style={[styles.accountCard, { backgroundColor: "#0C2A4D", borderColor: colors.primary }]}>
          <View style={[styles.accountIcon, { backgroundColor: colors.primary }]}>
            <MaterialIcons name="cloud-sync" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.accountCopy}>
            <Text style={[styles.accountTitle, { color: colors.foreground }]}>Войти в аккаунт</Text>
            <Text style={[styles.accountText, { color: colors.muted }]}>Синхронизируйте расследования между устройствами и сохраните профиль инженера.</Text>
          </View>
          <Pressable disabled={authLoading} onPress={() => void login()} style={({ pressed }) => [styles.loginButton, { backgroundColor: colors.primary, opacity: authLoading ? 0.55 : pressed ? 0.8 : 1 }]}>
            <Text style={styles.loginButtonText}>{authLoading ? "Проверка…" : "Войти"}</Text>
            <MaterialIcons name="arrow-forward" size={17} color="#FFFFFF" />
          </Pressable>
        </View>}

        {isAuthenticated && <View style={[styles.accountConnected, { backgroundColor: "#123B32", borderColor: "#237A59" }]}>
          <MaterialIcons name="verified-user" size={20} color={colors.success} />
          <View style={{ flex: 1 }}><Text style={[styles.accountTitle, { color: colors.foreground }]}>Аккаунт подключён</Text><Text style={[styles.accountText, { color: colors.muted }]}>Данные готовы к синхронизации через защищённое соединение.</Text></View>
          <MaterialIcons name="check-circle" size={21} color={colors.success} />
        </View>}

        <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Сводка пространства</Text>
          <View style={styles.statsRow}>
            <Summary label="Насосов" value={counts.pumps} colors={colors} icon="settings-input-component" />
            <Summary label="Кейсов" value={counts.investigations} colors={colors} icon="assignment" />
            <Summary label="Материалов" value={counts.evidence} colors={colors} icon="perm-media" />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Хранение и кэш</Text>
          <Text style={[styles.text, { color: colors.muted }]}>Повторные запросы возвращаются с устройства без повторного обращения к модели.</Text>
          <View style={styles.wrap}>{getAllowedCacheTtlDays().map((days) => (
            <Pressable key={days} onPress={async () => { await setCacheTtlDays(days); setTtl(days); }} style={[styles.chip, { backgroundColor: ttl === days ? colors.primary : colors.background, borderColor: ttl === days ? colors.primary : colors.border }]}>
              <Text style={[styles.chipText, { color: ttl === days ? "#FFFFFF" : colors.foreground }]}>{days} дн.</Text>
            </Pressable>
          ))}</View>
          <Pressable onPress={() => clearAiCache().then(() => Alert.alert("Готово", "Кэш очищен."))} style={[styles.secondary, { borderColor: colors.border }]}>
            <MaterialIcons name="delete-sweep" size={18} color={colors.primary} />
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>Очистить кэш</Text>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Резервная копия</Text>
          <Text style={[styles.text, { color: colors.muted }]}>Экспорт сохраняет расследования, насосы, материалы, измерения, задачи, корневые причины, мероприятия и журнал изменений.</Text>
          <Pressable onPress={() => backup().catch((error) => Alert.alert("Резервная копия не создана", String(error)))} style={[styles.primary, { backgroundColor: colors.primary }]}>
            <MaterialIcons name="file-upload" size={18} color="#FFFFFF" />
            <Text style={styles.primaryText}>Создать копию</Text>
          </Pressable>
          <Pressable onPress={restore} style={[styles.secondary, { borderColor: colors.border }]}>
            <MaterialIcons name="file-download" size={18} color={colors.primary} />
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>Восстановить копию</Text>
          </Pressable>
        </View>

        {isAuthenticated && <Pressable onPress={confirmLogout} style={[styles.logout, { borderColor: colors.error }]}>
          <MaterialIcons name="logout" size={18} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Выйти из аккаунта</Text>
        </Pressable>}
      </ScrollView>
    </ScreenContainer>
  );
}

function Summary({ label, value, icon, colors }: { label: string; value: number; icon: React.ComponentProps<typeof MaterialIcons>["name"]; colors: ReturnType<typeof useColors> }) {
  return <View style={styles.summary}><MaterialIcons name={icon} size={19} color={colors.primary} /><Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text><Text style={[styles.summaryLabel, { color: colors.muted }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 34 },
  topbar: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 2 },
  topbarBack: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  topbarTitle: { flex: 1, fontSize: 16, fontWeight: "900" },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 27, fontWeight: "900", marginTop: 4 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  headerIcon: { width: 50, height: 50, borderWidth: 1, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  profileCard: { borderWidth: 1, borderRadius: 20, padding: 17, flexDirection: "row", gap: 13, alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontSize: 25, fontWeight: "900" },
  profileDetails: { flex: 1, gap: 4 },
  profileName: { fontSize: 17, fontWeight: "900" },
  profileEmail: { fontSize: 11, lineHeight: 16 },
  accountCard: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  accountIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  accountCopy: { flex: 1, minWidth: 190, gap: 3 },
  accountTitle: { fontSize: 14, fontWeight: "900" },
  accountText: { fontSize: 11, lineHeight: 16 },
  loginButton: { minHeight: 40, borderRadius: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  loginButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  accountConnected: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  connectionBadge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  connectionDot: { width: 7, height: 7, borderRadius: 4 },
  connectionText: { fontSize: 10, fontWeight: "800" },
  statsCard: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 13 },
  sectionTitle: { fontSize: 16, fontWeight: "900" },
  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  summary: { flex: 1, gap: 4 },
  summaryValue: { fontSize: 23, fontWeight: "900" },
  summaryLabel: { fontSize: 11 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 9 },
  text: { fontSize: 12, lineHeight: 18 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 11 },
  chipText: { fontSize: 12, fontWeight: "800" },
  primary: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryText: { color: "#FFFFFF", fontWeight: "800" },
  secondary: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontWeight: "800" },
  logout: { minHeight: 46, borderWidth: 1, borderRadius: 13, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  logoutText: { fontWeight: "900" },
});
