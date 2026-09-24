import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import type { RcaChatContext, RcaChatMessage } from "@/shared/chat";
import { makeAiCacheKey } from "@/shared/ai";
import { readAiCache, readAiUsage, recordAiUsage, writeAiCache } from "@/lib/ai-cache";

type RcaChatProps = { context: RcaChatContext; onHistoryChange: (history: RcaChatMessage[]) => void };

const starters = [
  "Почему это считается корневой причиной?",
  "Какие данные нужно проверить первыми?",
  "Какая рекомендация имеет наивысший приоритет?",
];

export function RcaChat({ context, onHistoryChange }: RcaChatProps) {
  const colors = useColors();
  const [messages, setMessages] = useState<RcaChatMessage[]>(context.history.length > 0 ? context.history : [{ role: "assistant", content: "Я готов уточнить логику RCA, объяснить связь фактов с гипотезой или подсказать, какие проверки закрывают открытые вопросы." }]);
  const [question, setQuestion] = useState("");
  const chatMutation = trpc.rca.ask.useMutation();

  useEffect(() => {
    setMessages(context.history.length > 0 ? context.history : [{ role: "assistant", content: "Я готов уточнить логику RCA, объяснить связь фактов с гипотезой или подсказать, какие проверки закрывают открытые вопросы." }]);
  }, [context.history]);

  const sendQuestion = async (value = question) => {
    const trimmed = value.trim();
    if (!trimmed || chatMutation.isPending) return;
    const userMessage: RcaChatMessage = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    onHistoryChange(nextMessages);
    setQuestion("");
    try {
      const cacheKey = makeAiCacheKey("chat", { context, question: trimmed });
      const cachedAnswer = await readAiCache<string>(cacheKey);
      if (cachedAnswer) {
        const usage = await readAiUsage();
        const completedMessages = [...nextMessages, { role: "assistant" as const, content: cachedAnswer }];
        setMessages(completedMessages);
        onHistoryChange(completedMessages);
        await recordAiUsage({ cacheHits: usage.cacheHits + 1 });
        return;
      }
      const usage = await readAiUsage();
      await recordAiUsage({ cacheMisses: usage.cacheMisses + 1, chatCalls: usage.chatCalls + 1 });
      const response = await chatMutation.mutateAsync({ ...context, history: messages, question: trimmed });
      await writeAiCache(cacheKey, response.answer);
      const completedMessages = [...nextMessages, { role: "assistant" as const, content: response.answer }];
      setMessages(completedMessages);
      onHistoryChange(completedMessages);
    } catch {
      const failedMessages = [...nextMessages, { role: "assistant" as const, content: "Не удалось получить ответ сейчас. Проверьте соединение и повторите вопрос — сам отчёт RCA сохранён." }];
      setMessages(failedMessages);
      onHistoryChange(failedMessages);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: "#FFF0EC" }]}><MaterialIcons name="forum" size={19} color={colors.primary} /></View>
        <View style={{ flex: 1 }}><Text style={[styles.eyebrow, { color: colors.primary }]}>AI RCA DIALOGUE</Text><Text style={[styles.title, { color: colors.foreground }]}>Уточнить вывод</Text></View>
        <View style={[styles.contextBadge, { backgroundColor: colors.background }]}><Text style={[styles.contextText, { color: colors.muted }]}>контекст кейса</Text></View>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(_, index) => `chat-${index}`}
        scrollEnabled={false}
        contentContainerStyle={styles.messages}
        renderItem={({ item }) => <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.assistantMessage, { backgroundColor: item.role === "user" ? colors.primary : colors.background }]}><Text style={[styles.messageText, { color: item.role === "user" ? "#FFFFFF" : colors.foreground }]}>{item.content}</Text></View>}
      />

      <Text style={[styles.promptLabel, { color: colors.muted }]}>Быстрые вопросы</Text>
      <View style={styles.starters}>{starters.map((starter) => <Pressable key={starter} onPress={() => sendQuestion(starter)} disabled={chatMutation.isPending} style={({ pressed }) => [styles.starter, { borderColor: colors.border, opacity: chatMutation.isPending ? 0.5 : pressed ? 0.7 : 1 }]}><Text numberOfLines={1} style={[styles.starterText, { color: colors.foreground }]}>{starter}</Text></Pressable>)}</View>

      <View style={[styles.composer, { borderColor: colors.border, backgroundColor: colors.background }]}><TextInput value={question} onChangeText={setQuestion} onSubmitEditing={() => sendQuestion()} placeholder="Задайте вопрос по RCA…" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.foreground }]} multiline maxLength={2000} editable={!chatMutation.isPending} /><Pressable onPress={() => sendQuestion()} disabled={chatMutation.isPending || !question.trim()} style={({ pressed }) => [styles.send, { backgroundColor: colors.primary, opacity: chatMutation.isPending || !question.trim() ? 0.45 : pressed ? 0.8 : 1 }]}><MaterialIcons name={chatMutation.isPending ? "hourglass-top" : "arrow-upward"} size={19} color="#FFFFFF" /></Pressable></View>
      <Text style={[styles.disclaimer, { color: colors.muted }]}>Чат уточняет рабочую гипотезу и не заменяет проверку инженером.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.2, marginBottom: 2 },
  title: { fontSize: 17, fontWeight: "800" },
  contextBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  contextText: { fontSize: 9, fontWeight: "800" },
  messages: { gap: 8, paddingVertical: 2 },
  message: { maxWidth: "92%", borderRadius: 13, paddingHorizontal: 11, paddingVertical: 9 },
  userMessage: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistantMessage: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  messageText: { fontSize: 12, lineHeight: 18 },
  promptLabel: { fontSize: 10, fontWeight: "800", marginTop: 3 },
  starters: { gap: 7 },
  starter: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  starterText: { fontSize: 11, fontWeight: "700" },
  composer: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 11, paddingRight: 5, flexDirection: "row", alignItems: "center", gap: 6 },
  input: { flex: 1, minHeight: 38, maxHeight: 80, fontSize: 12, paddingVertical: 8 },
  send: { width: 37, height: 37, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  disclaimer: { fontSize: 9, lineHeight: 13 },
});
