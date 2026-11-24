import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import type { PhotoAnnotation } from "@/shared/rca";

type PhotoAnnotationEditorProps = {
  visible: boolean;
  uri?: string;
  fileName: string;
  annotations: PhotoAnnotation[];
  onSave: (annotations: PhotoAnnotation[]) => void;
  onClose: () => void;
};

export function PhotoAnnotationEditor({ visible, uri, fileName, annotations, onSave, onClose }: PhotoAnnotationEditorProps) {
  const colors = useColors();
  const [draftAnnotations, setDraftAnnotations] = useState<PhotoAnnotation[]>(annotations);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 260 });

  useEffect(() => {
    if (visible) {
      setDraftAnnotations(annotations);
      setPendingPoint(null);
      setPendingText("");
    }
  }, [annotations, visible]);

  const saveMarker = () => {
    if (!pendingPoint || !pendingText.trim()) return;
    setDraftAnnotations((current) => [...current, { id: `marker-${Date.now()}`, ...pendingPoint, text: pendingText.trim() }]);
    setPendingPoint(null);
    setPendingText("");
  };

  const closeWithoutSaving = () => {
    setDraftAnnotations(annotations);
    setPendingPoint(null);
    setPendingText("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeWithoutSaving}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>АННОТАЦИЯ ФОТО</Text>
            <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{fileName}</Text>
          </View>
          <Pressable onPress={closeWithoutSaving} style={[styles.closeButton, { backgroundColor: colors.surface }]}><MaterialIcons name="close" size={21} color={colors.foreground} /></Pressable>
        </View>

        <View style={[styles.hint, { backgroundColor: "#FFF8F3", borderColor: "#F6D6C8" }]}><MaterialIcons name="touch-app" size={19} color={colors.primary} /><Text style={[styles.hintText, { color: colors.foreground }]}>Нажмите на повреждение на фото, затем подпишите, что нужно проверить.</Text></View>

        <View style={styles.canvasWrap}>
          {uri ? <Pressable style={styles.canvas} onLayout={(event) => setCanvasSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })} onPress={(event) => { const { locationX, locationY } = event.nativeEvent; setPendingPoint({ x: Math.max(0.04, Math.min(0.96, locationX / canvasSize.width)), y: Math.max(0.04, Math.min(0.96, locationY / canvasSize.height)) }); }}><Image source={{ uri }} contentFit="contain" style={styles.photo} /><View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>{draftAnnotations.map((annotation, index) => <View key={annotation.id} style={[styles.marker, { left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%` }]}><View style={styles.markerDot}><Text style={styles.markerNumber}>{index + 1}</Text></View><View style={styles.markerLabel}><Text numberOfLines={2} style={styles.markerText}>{annotation.text}</Text></View></View>)}</View>{pendingPoint && <View style={[styles.pendingMarker, { left: `${pendingPoint.x * 100}%`, top: `${pendingPoint.y * 100}%`, pointerEvents: "none" }]}><View style={styles.pendingDot} /></View>}</Pressable> : <View style={styles.noPhoto}><MaterialIcons name="image-not-supported" size={30} color={colors.muted} /><Text style={[styles.noPhotoText, { color: colors.muted }]}>Фото недоступно на этом устройстве</Text></View>}
        </View>

        {pendingPoint && <View style={[styles.noteEditor, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.noteLabel, { color: colors.foreground }]}>Подпись маркера</Text><View style={styles.noteRow}><TextInput autoFocus value={pendingText} onChangeText={setPendingText} onSubmitEditing={saveMarker} placeholder="Например: скол на рабочем колесе" placeholderTextColor={colors.muted} style={[styles.noteInput, { color: colors.foreground, borderColor: colors.border }]} returnKeyType="done" /><Pressable onPress={saveMarker} style={[styles.addMarkerButton, { backgroundColor: colors.primary }]}><MaterialIcons name="add" size={21} color="#FFFFFF" /></Pressable></View></View>}

        <View style={styles.footer}><Text style={[styles.markerCount, { color: colors.muted }]}>{draftAnnotations.length} {draftAnnotations.length === 1 ? "маркер" : "маркеров"}</Text><Pressable onPress={() => { onSave(draftAnnotations); setPendingPoint(null); setPendingText(""); }} style={({ pressed }) => [styles.saveButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><MaterialIcons name="check" size={19} color="#FFFFFF" /><Text style={styles.saveText}>Сохранить аннотации</Text></Pressable></View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingTop: Platform.OS === "ios" ? 18 : 26, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E7EB" },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.3, marginBottom: 4 },
  title: { fontSize: 19, fontWeight: "800" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  hint: { margin: 20, marginBottom: 12, padding: 12, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 8, alignItems: "center" },
  hintText: { fontSize: 12, lineHeight: 17, flex: 1, fontWeight: "600" },
  canvasWrap: { marginHorizontal: 20, height: 330, borderRadius: 18, overflow: "hidden", backgroundColor: "#E8ECEE" },
  canvas: { flex: 1, position: "relative", alignItems: "center", justifyContent: "center" },
  photo: { width: "100%", height: "100%" },
  noPhoto: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  noPhotoText: { fontSize: 12 },
  marker: { position: "absolute", transform: [{ translateX: -10 }, { translateY: -10 }], alignItems: "flex-start" },
  markerDot: { width: 22, height: 22, borderRadius: 12, backgroundColor: "#1683F5", borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  markerNumber: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  markerLabel: { marginTop: 4, marginLeft: 8, maxWidth: 180, backgroundColor: "rgba(22,38,49,0.92)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 5 },
  markerText: { color: "#FFFFFF", fontSize: 10, lineHeight: 13, fontWeight: "700" },
  pendingMarker: { position: "absolute", transform: [{ translateX: -8 }, { translateY: -8 }] },
  pendingDot: { width: 17, height: 17, borderRadius: 9, backgroundColor: "#FFD166", borderWidth: 3, borderColor: "#FFFFFF" },
  noteEditor: { margin: 20, marginBottom: 4, padding: 12, borderRadius: 15, borderWidth: 1 },
  noteLabel: { fontSize: 11, fontWeight: "800", marginBottom: 7 },
  noteRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  noteInput: { flex: 1, minHeight: 43, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 12 },
  addMarkerButton: { width: 43, height: 43, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  footer: { padding: 20, marginTop: "auto", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  markerCount: { fontSize: 12, fontWeight: "700" },
  saveButton: { minHeight: 46, paddingHorizontal: 16, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 7 },
  saveText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});
