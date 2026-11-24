# PumpRCA — текущая архитектура и baseline

Дата аудита: 2026-10-02
Проект: `pump-rca-mobile`
Режим: существующее Expo/React Native приложение с web export

## 1. Framework и runtime

- Expo SDK 54
- React Native 0.81
- React 19
- Expo Router 6
- TypeScript 5.9
- NativeWind 4
- Android native layer: Gradle + CMake + JNI
- Browser build: Expo Metro web export

Главный экран и текущая навигация находятся в `app/(tabs)/`. На этапе 0–1 они не изменяются.

## 2. Существующая UI-структура

- `app/(tabs)/index.tsx` — список кейсов, создание/редактирование, evidence, анализ, результат, чат и удаление.
- `app/(tabs)/methodology.tsx` — методика RCA.
- `app/(tabs)/usage.tsx` — локальная статистика AI и кэш.
- `app/(tabs)/_layout.tsx` — tab-навигация.
- `components/photo-annotation-editor.tsx` — фото-аннотации.
- `components/rca-chat.tsx` — чат по выбранному результату.

Навигация и экраны используют существующий контракт и не заменяются domain-слоем автоматически.

## 3. Текущая модель данных

В `app/(tabs)/index.tsx` локально определены `PumpCase`, `Evidence` и `RcaResult`. `PhotoAnnotation` и chat-типы импортируются из `shared/`. Кейс содержит название отказа, тип оборудования, asset tag, location, severity, status, narrative, evidence, tags, chat history, result и updatedAt.

Текущие статусы: `В работе` и `Готово`.

## 4. Storage и текущие ключи

Основной storage — `@react-native-async-storage/async-storage`.

Существующие ключи:

- `pumprca.cases.v1` — кейсы и материалы текущего UI.
- `pumprca.local-models.v1` — локальные пути GGUF/mmproj на Android.
- `pumprca.ai.*` — AI cache и usage counters.
- `pumprca.ai.cache-ttl-days.v1` — TTL кэша.

На этапе 0–1 AsyncStorage сохраняется. Новый domain storage использует отдельный ключ `pumprca.domain.v2`, поэтому существующий UI-key не меняется.

## 5. Storage/API boundaries

До этапа 1 UI напрямую читает/пишет `pumprca.cases.v1` через AsyncStorage. Отдельного repository layer не было.

Добавленный domain boundary:

```text
Existing UI / production scenarios (unchanged)
        │
Legacy AsyncStorage: pumprca.cases.v1

New domain foundation
        │
PumpRcaRepository
        │
StorageAdapter
        │
AsyncStorage: pumprca.domain.v2
```

`StorageAdapter` отделяет domain/repository код от конкретного AsyncStorage API и позволяет тестировать repositories в памяти.

## 6. Existing AI components (зафиксированы, не изменяются)

### Android JNI AI

- Bridge: `lib/local-ai-native.ts` → React Native native module.
- Kotlin bridge: `android/app/src/main/java/com/app/pumprcamobile/localai/`.
- Native implementation: `android/app/src/main/cpp/local-ai/vision_poc.cpp`.
- Runtime: llama.cpp/libmtmd, Qwen2.5-VL + mmproj для vision, Qwen3 для текстового RCA.

### Browser WebGPU AI

- Adapter: `lib/browser-local-ai.ts`.
- Browser-only Transformers.js loader.
- WebGPU vision и локальный ONNX text RCA.
- `lib/local-ai-native.ts` маршрутизирует web в browser adapter, Android — в native bridge.

### AI cache

- `lib/ai-cache.ts`.
- TTL, cache key и usage counters работают через AsyncStorage.
- На этапе 0–1 не изменяются.

## 7. Existing media pipeline

- Фото: Expo ImagePicker → ImageManipulator → JPEG до 1024 px / quality 80%.
- Видео Android: Expo VideoThumbnails.
- Видео browser: HTML video + Canvas extraction candidate frames.
- Кадры передаются в существующий local vision adapter.

На этапе 0–1 pipeline не меняется.

## 8. Existing PDF pipeline

- HTML builder: `shared/report.ts`.
- Native PDF/share: `expo-print` и `expo-sharing`.
- На этапе 0–1 генератор PDF и его входной контракт не изменяются.

## 9. Production scenarios preserved

Без изменения поведения сохраняются:

1. открыть приложение и увидеть список кейсов;
2. создать и редактировать кейс;
3. добавить фото, видео, текст и файл;
4. добавить фото-аннотации;
5. запустить существующий local AI analysis;
6. открыть RCA result и чат;
7. использовать cache-only режим;
8. экспортировать существующий PDF;
9. использовать теги, фильтры и удалить один кейс;
10. закрыть и открыть приложение с восстановлением legacy кейсов.

## 10. Baseline verification

Перед изменением domain foundation были проверены TypeScript, существующие unit tests и production web export. После этапа 1 эти проверки запускаются повторно.

## 11. Backup

Создана git-ветка: `backup/pumprca-v2-baseline`.

Временная полная копия была создана до очистки build-кэшей. Из-за заполнения диска она удалена после подтверждения сохранности git backup branch; исходники проекта не удалялись.

## 12. Technical debt and risks

1. Current UI model is local to `index.tsx`; domain layer добавляется как совместимый foundation без агрессивного переноса UI.
2. `pumprca.cases.v1` содержит свободную legacy-схему; migration применяет tolerant parsing и не удаляет старые поля.
3. Большие media blobs не должны сериализоваться в domain JSON; сохраняются URI и metadata.
4. Android native inference требует device-level validation; этап 0–1 его не меняет.
5. Browser AI зависит от WebGPU и первичной загрузки моделей; этап 0–1 его не меняет.
