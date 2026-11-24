# Надёжкин — исходники Android и backend

Дата экспорта: 2026-11-04

## Состояние исходников

- Проект: `pump-rca-mobile`
- Git HEAD: `85a0a8ccf9658f44a6810bf032c540c89d263384`
- Текущая ветка и рабочее дерево: экспортировано актуальное состояние рабочей папки, включая незакоммиченные изменения.
- В архив намеренно не включены `.git`, `node_modules`, APK и промежуточные build-каталоги.

## Дополнение от 2026-11-05 — Document Agent

- Добавлен отдельный `server/ai/document-agent.ts`; он запускается из `runRcaOrchestrator` до Analyst.
- Первая версия поддерживает PDF, TXT, CSV, JSON и Markdown; DOCX/XLSX пока не поддерживаются.
- PDF-парсер OpenRouter явно закреплён за бесплатным `cloudflare-ai`; платный `mistral-ocr` не используется.
- Извлечённые факты, измерения и события проверяются на точные `evidenceRef`.
- Лимиты: до 10 документов, до 5,5 МБ на файл, до 15 МБ суммарно; текстовые документы ограничены 50 000 символами на файл и 150 000 суммарно.
- Добавлены тесты Document Agent, маршрутизации и интеграции в RCA. Синтаксическая транспиляция изменённых файлов пройдена; полный check/Vitest/build заблокированы отсутствующими зависимостями и недоступностью npm registry. Подробности — `DOCUMENT_AGENT_HANDOFF.md`.

## Дополнение от 2026-11-05 — Technical Expert

- Добавлен `server/ai/technical-expert-agent.ts` для инженерной интерпретации насосного оборудования.
- Агент использует существующий текстовый `EQUIPMENT_ANALYSIS` / reserve free route; новых платных API или моделей нет.
- Запускается после Video Agent и Document Agent и до Analyst; результат доступен Analyst, Critic и Composer.
- Проверяет точные `evidenceRefs` и индексы поддерживающих фактов; механизмы отказа остаются гипотезами.
- Запрещено выдумывать допуски, рабочие пределы, стандарты и паспортные параметры. Изображения повторно не передаются.
- Добавлена диагностическая стадия `technical` и тесты агента/интеграции. Синтаксическая транспиляция изменённых файлов пройдена; полный check/Vitest/lint/build не запускались из-за отсутствующих зависимостей. Подробности — `TECHNICAL_EXPERT_HANDOFF.md`.

## Что входит

- React Native / Expo Android-приложение «Надёжкин».
- Android native-проект и ресурсы приложения.
- Backend Express/tRPC, OAuth, ACL, CSRF, storage и репозитории данных.
- AI Gateway, CostGuard, ZERO_COST_ONLY, allowlist бесплатных моделей и RCA-оркестратор Analyst → Reliability Engineer → Critic → Composer.
- Обработка текстов, фото, видео и документов.
- PDF/отчётность, локальное хранилище, синхронизация и доменные события.
- Native prototype под `native/llama.cpp` и `native/vision-poc-android` — только исходники, без собранных библиотек и моделей.
- Drizzle-схема и миграции.
- Тесты Vitest, конфигурации TypeScript/Expo/Metro/Gradle и lock-файл `pnpm-lock.yaml`.
- Автономные web/PWA-артефакты `nadezhkin-pwa.html` и `nadezhkin-prototype.html` как вспомогательные клиентские исходники.

## Что исключено

- `node_modules/`, `.git/`, `.expo/`, `dist/`, `dist-web/` и прочие генерируемые сборки.
- `android/app/build/`, `android/.gradle/`, `android/local.properties` и native Gradle/CMake build-кэши.
- Готовые APK, AAB, `.so`, `.a`, `.o`, `.gguf`, `.bin`, `.safetensors` и другие большие бинарные артефакты моделей/сборок.
- `android/app/debug.keystore`, private keys, сертификаты, `.env` и локальные конфигурации.
- `.manus-logs/`, логи и временные файлы.
- Реальные значения секретов. В архиве оставлены только имена переменных окружения.

## Установка зависимостей

```bash
corepack enable
pnpm install --frozen-lockfile
```

Для Android нужны JDK 17, Android SDK/NDK и Gradle wrapper из `android/gradlew`.

## Проверки

```bash
pnpm check
pnpm test
pnpm lint
pnpm build:server
```

## Android release-сборка

```bash
pnpm install --frozen-lockfile
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

Итоговый APK появится в `android/app/build/outputs/apk/release/`. Для Samsung S25 Ultra нужен `arm64-v8a`; перед релизом проверьте `app.config.ts`, production API URL и signing-конфигурацию. Архив не содержит signing-ключей.

## Web-экспорт

```bash
PUMPRCA_WEB_EXPORT=1 \
PUMPRCA_WEB_API_BASE_URL=https://<ваш-production-backend> \
  pnpm export:web
```

## Необходимые переменные окружения

### Backend и безопасность

- `NODE_ENV`
- `JWT_SECRET` — минимум 32 символа в production
- `DATABASE_URL`
- `VITE_APP_ID`
- `OAUTH_SERVER_URL`
- `OWNER_OPEN_ID`
- `PUMPRCA_ALLOWED_ORIGINS`
- `PUMPRCA_SESSION_COOKIE_DOMAIN`
- `EXPO_WEB_PREVIEW_URL` или production web redirect
- `EXPO_PACKAGER_PROXY_URL` — только для dev/preview

### Multi-agent RCA stages

When `PUMPRCA_MULTI_AGENT_ENABLED=true`, the server runs the bounded sequential pipeline. The optional media stages run first when relevant inputs are attached (Video Agent and Document Agent), followed by Technical Expert, Analyst, Critic, and Composer. Technical Expert uses the `reserve` free-model allowlist and `EQUIPMENT_ANALYSIS` task, receives text-only context, must cite only supplied evidence references, and labels failure mechanisms as hypotheses. If this flag is unset or false, the existing single-agent fallback remains active; deployment must explicitly enable the flag to activate the full chain. No AI credentials or provider secrets belong in the APK.

### AI и zero-cost policy

- `OPENROUTER_API_KEY`
- `OPENROUTER_GENERAL_MODEL`
- `OPENROUTER_REASONING_MODEL`
- `OPENROUTER_VISION_MODEL`
- `OMNIROUTE_BASE_URL`
- `OMNIROUTE_API_KEY`
- `OMNIROUTE_FREE_MODELS`
- `OMNIROUTE_ENABLED`
- `OMNIROUTE_ZERO_COST_CONFIRMED`
- `PUMPRCA_MULTI_AGENT_ENABLED`
- `ZERO_COST_ONLY` — если используется конфигурацией текущего deployment

Секреты должны задаваться только в серверном secret manager или environment production. Не добавляйте их в APK и не коммитьте `.env`.

### Встроенные платформенные интеграции

При необходимости backend также использует переменные платформенных встроенных API, например `BUILT_IN_FORGE_API_URL` и `BUILT_IN_FORGE_API_KEY`. Их значения не экспортируются.

## Архитектурная заметка

Android-клиент обращается к backend через tRPC/API. API-ключи AI должны оставаться на сервере. Production RCA должен проходить строгую валидацию `pump_rca_result`; ошибки 401/403/429/500, тайм-ауты, недоступные модели и невалидный JSON должны показываться безопасно, без prompt, материалов расследования, токенов и stack trace.

## Известные ограничения

- Бесплатные AI-маршруты зависят от доступности, квот и лимитов провайдера; обнаружение модели не подтверждает успешный inference.
- Возможны временные HTTP 502/503/429 и тайм-ауты AI Gateway.
- Production-публикация backend и OAuth/CORS требуют настроек WebDev/production environment; health `200` сам по себе не подтверждает версию backend.
- Локальный Qwen3 native prototype текстовый и не анализирует фотографии/видео напрямую; для media нужен отдельный OCR/vision pipeline.
- PDF-отчёт зависит от заполненности расследования и наличия корректных данных/материалов.
- Физическая проверка на Samsung S25 Ultra не является частью создания этого архива.
