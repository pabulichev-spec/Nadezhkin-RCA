# PumpRCA — Stage 3 production foundation

Дата: 2026-10-05

## Реализовано

- Расширенная domain schema v3 с backward-compatible сущностями: pumps, investigations, evidence, measurements, hypotheses, symptoms, consequences, timeline, cause nodes, 5 Why, root cause, tasks, corrective actions, effectiveness checks и audit log.
- Repository API для всех сущностей поверх AsyncStorage; legacy storage остаётся читаемым через migration.
- Workspace service:
  - 16 типовых RCA-задач;
  - completion gates для review / approval / close;
  - проверка подтверждённого Root Cause;
  - SMART action factory.
- `.pumprca` archive:
  - manifest с format/schema/app version;
  - экспорт одного расследования;
  - import merge с idempotent replacement;
  - backup/restore всего domain state.
- Existing PDF pipeline расширен инженерными секциями:
  - failure event и timeline;
  - evidence/photos/video frames;
  - measurements;
  - hypotheses;
  - четыре RCA блока;
  - Cause Tree;
  - 5 Why;
  - 16 задач;
  - Root Cause;
  - corrective actions, before/after и effectiveness;
  - limitation statement.
- В существующий экран карточки кейса добавлен экспорт `.pumprca`.
- При создании domain investigation автоматически создаётся набор из 16 задач.

## Не изменено

- Existing AI calls, Android JNI AI, Browser WebGPU AI и media preparation pipeline.
- Existing navigation and screen routes.
- AsyncStorage не заменён IndexedDB.
- Existing legacy `PumpCase` data model and storage key retained.

## Проверки

- TypeScript: passed.
- Vitest: 27 passed, 1 skipped.
- ESLint: passed with existing Node module-type warning.
- Expo web production export: passed; 10 static routes and browser-local-ai chunk generated.

## Known risks / next stage

- Full multi-screen operations UI (pumps registry, master-detail timeline, Cause Tree editor, 5 Why editor, measurement tables, actions/effectiveness board, import picker and backup settings) should be exposed in a dedicated UI stage; the current stage adds the domain/repository/report foundation and a safe export entry point.
- Native Android release rebuild is intentionally not part of this stage; Android JNI sources were not changed.
- Import UI is not yet exposed; parser and merge service are covered as domain APIs.
