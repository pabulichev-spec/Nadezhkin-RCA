# Надёжкин — Technical Expert handoff

## Что реализовано

- Добавлен `server/ai/technical-expert-agent.ts` — отдельный текстовый агент технической экспертизы насосного оборудования.
- Используется существующий `EQUIPMENT_ANALYSIS` task и только текстовый `reserve` free allowlist; платные модели и новые API не добавлялись.
- Агент получает текстовый контекст расследования и результаты Video Agent / Document Agent. Изображения и бинарные вложения повторно не передаются.
- Структурированный результат включает техническую оценку, факты с точными `evidenceRefs`, возможные механизмы отказа, альтернативы, диагностические проверки, необходимые измерения, недостающие данные и меры предосторожности.
- Все ссылки на доказательства сверяются с `knownEvidenceRefs`; индексы поддерживающих фактов проверяются по фактическому массиву.
- Механизмы отказа маркируются только как `HYPOTHESIS`, `PLAUSIBLE` или `INSUFFICIENT_DATA`; агенту запрещено придумывать допуски, рабочие пределы, материалы, стандарты и требования изготовителя.
- `runRcaOrchestrator` запускает Technical Expert после Video Agent и Document Agent, но до Analyst. Результат попадает в контекст Analyst, Critic и Composer.
- Добавлена диагностическая стадия `technical`, включая безопасный tRPC error envelope.
- Для тестов добавлена опция `technicalExpertEnabled`; в production по умолчанию агент включён при включённом multi-agent RCA.

## Zero-cost и безопасность

- Используется только существующий `reserve` allowlist; модель дополнительно проверяется общим resolver/CostGuard до запроса.
- Существующие `ZERO_COST_ONLY`, CostGuard и запрет платного fallback не ослаблялись.
- Агент не получает image/video payload повторно; ему передаются только текстовые части контекста и результаты специализированных media agents.
- В системной инструкции запрещены выдуманные нормы, допуски, паспортные параметры и опасные действия без безопасной процедуры.
- Факты обязаны ссылаться на известные evidence refs; гипотезы не выдаются за подтверждённые причины.

## Изменённые файлы

- `server/ai/technical-expert-agent.ts` (новый)
- `server/ai/rca-orchestrator.ts`
- `server/ai/rca-diagnostics.ts`
- `server/routers.ts`
- `tests/technical-expert-agent.test.ts` (новый)
- `tests/rca-orchestrator.test.ts`
- `HANDOFF.md`

## Проверки и ограничения

- Синтаксическая транспиляция TypeScript пройдена для всех изменённых TypeScript-файлов.
- Полный `pnpm check`, Vitest, lint, server build и Android APK build не запускались: архив не содержит `node_modules`, а `pnpm`/зависимости недоступны в текущем окружении.
- Реальный inference не выполнялся: секреты и OpenRouter/OmniRoute credentials в архив не включены.
- До релизной сборки в Manus/PolyDev необходимо выполнить `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm build:server`, затем реальный RCA smoke test на тестовом расследовании с безопасными материалами.
