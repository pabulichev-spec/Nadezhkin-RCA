export type RcaChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RcaChatContext = {
  caseTitle: string;
  equipmentType: string;
  assetTag: string;
  location: string;
  narrative: string;
  result: {
    executiveSummary: string;
    physicalCause: string;
    humanFactor: string;
    systemicCause: string;
    smartActions: { priority: string; specific: string; measurable: string; achievable: string; relevant: string; timeBound: string }[];
    confidence: number;
    openQuestions: string[];
    methodNotes: string;
  };
  evidence: { kind: string; name: string; note?: string }[];
  history: RcaChatMessage[];
};

export function buildRcaChatPrompt(context: RcaChatContext) {
  const result = context.result;
  const history = context.history.map((message) => `${message.role === "user" ? "Пользователь" : "Ассистент"}: ${message.content}`).join("\n");
  const evidence = context.evidence.map((item, index) => `${index + 1}. ${item.kind} — ${item.name}${item.note ? `: ${item.note}` : ""}`).join("\n");
  return `Ответь на уточняющий вопрос пользователя по уже проведённому RCA-расследованию насосного оборудования. Отвечай на русском языке, кратко и по делу.

Жёсткие правила:
1) Используй только контекст ниже; не выдумывай измерения, события или нормативные требования.
2) Разделяй факт, вывод отчёта и рабочую гипотезу. Если данных недостаточно — прямо скажи это и предложи проверку.
3) Не заменяй инженера и не давай разрешение на эксплуатацию или ремонт без проверки ответственным специалистом.
4) Если вопрос не относится к этому кейсу или RCA — вежливо верни пользователя к расследованию.

Кейс: ${context.caseTitle}
Оборудование: ${context.equipmentType}
Актив: ${context.assetTag}
Локация: ${context.location}
Описание события: ${context.narrative}

Итог RCA:
Краткий вывод: ${result.executiveSummary}
1. Физическая причина: ${result.physicalCause}
2. Человеческий фактор: ${result.humanFactor}
3. Системная причина: ${result.systemicCause}
4. SMART-мероприятия: ${result.smartActions.map((item) => `${item.priority}: S=${item.specific}; M=${item.measurable}; A=${item.achievable}; R=${item.relevant}; T=${item.timeBound}`).join(" | ")}
Уверенность: ${result.confidence}%
Открытые вопросы: ${result.openQuestions.join("; ")}
Ограничения: ${result.methodNotes}

Материалы:
${evidence || "Материалы не приложены."}

История диалога:
${history || "Диалог только начинается."}

Сформулируй ответ на последнее сообщение пользователя. Не повторяй весь отчёт, если пользователь не просит об этом.`;
}
