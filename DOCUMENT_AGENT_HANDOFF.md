# Надёжкин — Document Agent handoff

## Что добавлено

- `server/ai/document-agent.ts` — отдельный Document Agent со строгой JSON-схемой и нормализацией ответа.
- Поддерживаемые форматы первой версии: PDF, TXT, CSV, JSON, Markdown.
- Для текстовых файлов содержимое декодируется на сервере и передаётся как текст; суммарный фрагмент ограничен 150 000 символами, не более 50 000 на файл.
- PDF передаётся через OpenRouter `file` content part. Для PDF-парсинга явно задан `cloudflare-ai`; платный `mistral-ocr` не используется.
- Извлечённые факты, измерения и события обязаны ссылаться на точное имя исходного доказательства. Выдуманные `evidenceRef` отклоняются.
- Ограничения: до 10 документов за RCA, до 5,5 МБ на документ и до 15 МБ суммарно.
- `DOCUMENT_ANALYSIS` принудительно направляется через OpenRouter multimodal pool; текстовый OmniRoute не используется для документов.
- `runRcaOrchestrator` запускает Document Agent до Analyst и добавляет его структурированный результат в контекст RCA.
- Стадия `document` включена в безопасную диагностику и транспортные ошибки.
- Android picker расширен на JSON и Markdown; MIME определяется также по расширению, если провайдер файла не сообщил поддерживаемый MIME.

## Сохранённые ограничения

- ZERO_COST_ONLY / CostGuard / allowlist не ослаблялись.
- Не добавлялись платные API, платные модели или платный OCR.
- DOCX и XLSX в этой версии не поддерживаются и не должны приниматься как анализируемые документы.
- OCR сканированных PDF зависит от бесплатного PDF parser Cloudflare AI; если текст/таблицы не распознаны, агент обязан сообщить об этом в `missingData`, а не выдумывать значения.
- Реальный inference не запускался: в экспортированном окружении отсутствуют секреты и доступ к OpenRouter.

## Проверки

Добавлены тесты:

- `tests/document-agent.test.ts`
- `tests/document-provider.test.ts`
- `tests/provider-router.test.ts`
- обновлены `tests/ai-media.test.ts`, `tests/rca-orchestrator.test.ts`, `tests/transport.test.ts`.

Все изменённые TypeScript/TSX-файлы прошли синтаксическую транспиляцию TypeScript.
Полный `pnpm check`, Vitest, lint и Android build не запускались: `node_modules` отсутствует, а загрузить pnpm из npm registry в текущем окружении не удалось.

## Команды проверки в Manus / PolyDev

```bash
pnpm check
pnpm test
pnpm lint
pnpm build:server
```

После успешных проверок отдельно выполнить Release APK build и реальный тест PDF/TXT/CSV на настроенном бесплатном OpenRouter маршруте. Перед реальным PDF inference убедиться по логам запроса, что plugin указан как `file-parser` с `pdf.engine = cloudflare-ai`.
