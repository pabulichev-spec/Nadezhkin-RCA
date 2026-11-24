# Надёжкин — единый исходный архив AI-агентов

В архив включена накопительная версия проекта с предыдущими этапами разработки:

1. **Video Agent** — `server/ai/video-agent.ts`, тест `tests/video-agent.test.ts`.
2. **Document Agent** — `server/ai/document-agent.ts`, тест `tests/document-agent.test.ts`.
3. **Technical Expert Agent** — `server/ai/technical-expert-agent.ts`, тест `tests/technical-expert-agent.test.ts`.
4. **Photo Agent** — `server/ai/photo-agent.ts`, тест `tests/photo-agent.test.ts`.

Общая интеграция агентов находится в `server/ai/rca-orchestrator.ts`; интеграционные проверки — в `tests/rca-orchestrator.test.ts`.

## Важно перед сборкой

Архив объединяет исходники и изменения всех перечисленных этапов. Это **не подтверждение** того, что все агенты уже прошли совместный полный прогон. Перед выпуском необходимо выполнить полный TypeScript typecheck, весь Vitest-набор, проверить порядок передачи результатов агентов в RCA pipeline, выполнить реальный запрос к доступной бесплатной Vision/Document модели и подтвердить блокировку платных моделей при `ZERO_COST_ONLY=true`. Только после успешных проверок собирать Release APK.
