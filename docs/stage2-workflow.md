# PumpRCA — Stage 2 workflow foundation

Дата: 2026-10-05

## Реализовано

- Domain status machine: `DRAFT → DATA_COLLECTION → ANALYSIS → PENDING_REVIEW → APPROVAL → APPROVED → CLOSED`.
- Разрешены возвраты `PENDING_REVIEW/APPROVAL/APPROVED → ANALYSIS` только с обязательной причиной.
- Добавлена progress-модель 0/20/40/70/85/95/100%.
- Добавлен workflow service `transitionInvestigation()` с validation бизнес-правил.
- Repository выполняет переход статуса атомарно вместе с `AuditEvent`.
- Прямой `replaceInvestigation()` не позволяет менять status; изменение проходит через workflow service.
- Audit log append-only по API repository; в UI показываются последние события активного расследования.
- Legacy `PumpCase` сохраняется без удаления и связывается через `legacyCaseId`.
- Existing AsyncStorage remains the storage boundary; migration maps legacy `WAITING_REVIEW` to `PENDING_REVIEW`.

## UI integration

Изменён только существующий экран активного кейса: добавлены status card, progress bar, разрешённые transition buttons, audit trail и Android-compatible modal для причины возврата. Existing navigation, AI calls, media processing, PDF export and legacy case list remain unchanged.

## Не входит в Stage 2

- Отдельные экраны для workflow.
- RBAC, server sync, attachments UI redesign.
- Изменение local JNI AI или Browser WebGPU AI.
- Изменение PDF/report pipeline.
- Исправление legacy UI status filters; они продолжают отражать `PumpCase.status`.

## Acceptance

- TypeScript check: passed.
- Vitest: 24 passed, 1 skipped.
- ESLint: passed.
- Expo web export: passed.
- Android native build was not rerun: Stage 2 changes are TypeScript/domain/UI only and do not touch Android JNI sources.
