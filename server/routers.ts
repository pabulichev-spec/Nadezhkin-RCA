import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { formatRcaEvidence } from "../shared/rca";
import { buildRcaChatPrompt } from "../shared/chat";

const evidenceSchema = z.object({
  kind: z.enum(["photo", "video", "text", "file"]),
  name: z.string().max(200),
  note: z.string().max(2000).optional(),
  imageData: z.string().max(7_000_000).optional(),
});

const rcaOutputSchema = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    eventChain: { type: "array", items: { type: "string" } },
    immediateCause: { type: "string" },
    contributingFactors: { type: "array", items: { type: "string" } },
    rootCause: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string" },
          action: { type: "string" },
          owner: { type: "string" },
          horizon: { type: "string" },
        },
        required: ["priority", "action", "owner", "horizon"],
        additionalProperties: false,
      },
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    openQuestions: { type: "array", items: { type: "string" } },
    methodNotes: { type: "string" },
  },
  required: [
    "executiveSummary",
    "eventChain",
    "immediateCause",
    "contributingFactors",
    "rootCause",
    "recommendations",
    "confidence",
    "openQuestions",
    "methodNotes",
  ],
  additionalProperties: false,
} as const;

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  rca: router({
    ask: publicProcedure
      .input(z.object({
        caseTitle: z.string().min(1).max(255),
        equipmentType: z.string().max(120),
        assetTag: z.string().max(120),
        location: z.string().max(200),
        narrative: z.string().max(8000),
        result: z.object({
          executiveSummary: z.string().max(6000),
          eventChain: z.array(z.string().max(800)).max(20),
          immediateCause: z.string().max(3000),
          contributingFactors: z.array(z.string().max(1000)).max(20),
          rootCause: z.string().max(3000),
          recommendations: z.array(z.object({ priority: z.string().max(20), action: z.string().max(1000), owner: z.string().max(200), horizon: z.string().max(100) })).max(20),
          confidence: z.number().min(0).max(100),
          openQuestions: z.array(z.string().max(1000)).max(20),
          methodNotes: z.string().max(3000),
        }),
        evidence: z.array(z.object({ kind: z.string().max(30), name: z.string().max(200), note: z.string().max(2000).optional() })).max(12),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12),
        question: z.string().min(1).max(2000),
      }))
      .mutation(async ({ input }) => {
        const prompt = buildRcaChatPrompt({ ...input, history: [...input.history, { role: "user", content: input.question }] });
        const response = await invokeLLM({
          model: "gemini-3.1-pro-preview",
          messages: [
            { role: "system", content: "Ты — инженер по надёжности насосного оборудования, отвечающий на вопросы по существующему RCA-отчёту. Отвечай на русском языке." },
            { role: "user", content: prompt },
          ],
          maxTokens: 1600,
        });
        const raw = response.choices[0]?.message?.content;
        if (typeof raw !== "string" || !raw.trim()) throw new Error("RCA chat returned an empty response");
        return { answer: raw.trim() };
      }),
    analyze: publicProcedure
      .input(z.object({
        caseTitle: z.string().min(1).max(255),
        equipmentType: z.string().max(120),
        assetTag: z.string().max(120),
        location: z.string().max(200),
        narrative: z.string().max(8000),
        evidence: z.array(evidenceSchema).max(12),
      }))
      .mutation(async ({ input }) => {
        const evidenceText = input.evidence.map((item, index) => {
          return `${index + 1}. ${formatRcaEvidence(item.kind, item.name, item.note)}`;
        }).join("\n");

        const content: any[] = [{
          type: "text",
          text: `Проведи предварительное расследование отказа насосного оборудования по методике RCA. Отвечай на русском языке и верни строго JSON по заданной схеме.

Кейс: ${input.caseTitle}
Тип оборудования: ${input.equipmentType}
Тег актива: ${input.assetTag}
Локация: ${input.location}
Описание события: ${input.narrative}
Материалы и свидетельства:
${evidenceText || "Материалы не приложены."}

Правила анализа:
1) Разделяй подтверждённые факты, рабочие гипотезы и пробелы в данных.
2) Построй цепочку событий от нормальной работы до отказа.
3) Укажи непосредственную причину, способствующие факторы и системную корневую причину.
4) Примени логику 5 Why и анализ барьеров: что должно было предотвратить событие и почему барьер не сработал.
5) Рекомендации должны быть конкретными, измеримыми и иметь владельца/горизонт.
6) Не выдавай догадку за доказанный факт; если материалов мало, понизь confidence и добавь openQuestions.
7) Это рабочая инженерная гипотеза, а не разрешение на эксплуатацию. В methodNotes зафиксируй ограничения анализа.`,
        }];

        for (const item of input.evidence) {
          if (item.imageData) {
            content.push({ type: "image_url", image_url: { url: item.imageData, detail: "auto" } });
          }
        }

        const response = await invokeLLM({
          model: "gemini-3.1-pro-preview",
          messages: [
            { role: "system", content: "Ты — опытный инженер по надёжности насосного оборудования и фасилитатор RCA. Будь строгим к доказательствам, не выдумывай измерения и марки материалов." },
            { role: "user", content },
          ],
          reasoning: { effort: "medium" },
          maxTokens: 5000,
          response_format: {
            type: "json_schema",
            json_schema: { name: "pump_rca_result", strict: true, schema: rcaOutputSchema },
          },
        });

        const raw = response.choices[0]?.message?.content;
        if (typeof raw !== "string") throw new Error("RCA model returned an empty response");
        return JSON.parse(raw);
      }),
  }),
});

export type AppRouter = typeof appRouter;
