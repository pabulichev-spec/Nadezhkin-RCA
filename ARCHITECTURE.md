# PumpRCA — Architecture Audit and Web-only Migration

**Audit date:** 2026-10-08  
**Current project:** Expo SDK 54 / React Native 0.81 / Expo Router / NativeWind / TypeScript

## 1. Current runtime architecture

### Client

- Expo Router entry under `app/`.
- Main Reliability Control Center screen: `app/(tabs)/index.tsx`.
- Existing routes include investigations, pump registry, usage/AI cache, settings and RCA workspace.
- Desktop web uses an industrial sidebar/top bar; mobile web uses a compact menu.
- Web build is Expo Metro static output and is reachable from desktop/mobile browsers.

### Persistence and domain

- Legacy investigation/case state remains in AsyncStorage.
- Domain state is layered over the legacy data in `lib/domain-repository.ts`.
- Domain schema/migrations are in `shared/domain/types.ts` and `shared/domain/migration.ts`.
- Existing entities include pumps, investigations, evidence, measurements, symptoms, hypotheses, causes, RCA tasks, SMART/corrective actions, audit events and reports.
- Existing browser persistence is therefore local-first; no IndexedDB migration is planned.

### Existing AI paths (before web-only migration)

- `lib/browser-local-ai.ts`: Transformers.js local browser pipeline with WebGPU → WASM fallback.
- `lib/local-ai-native.ts`: Android native bridge.
- `android/`: JNI/llama.cpp/libmtmd and GGUF runtime.
- `server/_core/llm.ts`: server LLM adapter currently targeting the built-in Forge-compatible endpoint.
- `server/routers.ts`: current RCA analyze/chat procedures directly call `invokeLLM` and hard-code a paid/unknown model ID.
- Existing result parsing, cache and RCA UI are client-owned and must remain compatible.

### Server

- Express server in `server/_core/index.ts`.
- tRPC transport at `/api/trpc`.
- Router contract in `server/routers.ts`.
- Existing environment mapping in `server/_core/env.ts`.
- Existing database/Drizzle scaffolding is present, but current RCA case persistence used by the main screen is still local-first.

## 2. Target web-only architecture

```text
Android / iPhone / Desktop browser
        ↓
Expo web client + AsyncStorage-compatible browser storage
        ↓ tRPC /api/trpc
AI Gateway (server only)
        ├── Model Registry
        ├── CostGuard (ZERO_COST_ONLY)
        ├── Quota Manager
        ├── Task Router
        └── OpenRouter Provider
                ↓
        OpenRouter free models / openrouter/free
                ↓
Validated structured RCA response
        ↓
Existing RCA parser, cache, workspace and PDF export
```

## 3. Web-only policy

- Browser is the only supported runtime for AI analysis.
- Android native AI, JNI, llama.cpp, libmtmd, GGUF, mmproj, local WebGPU and local WASM inference are not used by the web RCA workflow.
- Native source remains in the repository during migration for rollback and APK reproducibility; it is not loaded by web bundles and is removed only in a later cleanup after regression acceptance.
- No API key is sent to the frontend, stored in localStorage, logged or placed in URLs.
- `ZERO_COST_ONLY=true` is mandatory.
- A request is allowed only when the selected model has zero prompt, completion, request, image and reasoning pricing.
- No paid fallback is permitted. If no eligible model exists, the user receives a quota/model-unavailable error and the local investigation remains saved.

## 4. Existing production scenarios to preserve

1. Create an investigation and choose pump/equipment type.
2. Add text notes, photos, videos, annotations, tags and filters.
3. Extract bounded video frames and compress images before AI transfer.
4. Run structured RCA with physical cause, human factor, systemic cause and SMART actions.
5. Review result, chat history, 5 Why, Cause Tree and RCA Workspace.
6. Export PDF and `.pumprca` archive.
7. Use cache-only mode and persistent local cache.
8. Delete one investigation with confirmation.
9. Reopen investigations after browser restart.
10. Use Dashboard KPI/status/navigation views.

## 5. Migration stages

### Stage 0 — completed by this document

- Architecture and boundaries audited.
- Existing local/domain storage and RCA contracts recorded.
- Existing native, browser-local and server AI paths recorded.
- Web-only target and non-negotiable cost/privacy rules recorded.

### Stage 1 — in progress

- Add provider-agnostic AI Gateway types and services.
- Add dynamic OpenRouter model registry.
- Add zero-cost CostGuard.
- Add free-only quota/error classification.
- Add unit tests without changing the existing UI.

### Stage 2+

- Connect the server gateway to OpenRouter after the server secret/connector is configured.
- Replace direct hard-coded LLM calls in RCA/chat procedures.
- Switch the web RCA workflow from local inference to tRPC.
- Add AI status/cost/quota dashboard widgets.
- Add structured response validation, source awareness and audit records.
- Remove obsolete native/local AI UX after end-to-end web acceptance.

### Stage 3C — implemented on 2026-10-18

- Added additive tenant schema for workspaces, memberships, invitations, investigations, investigation ACLs, evidence metadata, immutable RCA results, chat messages, corrective actions, tags and audit events.
- Added repository modules under `server/repositories/` with workspace-scoped authorization, investigation-level permissions, owner/admin rules, invitation token hashing and audit append points.
- Added active-user tRPC procedures under `server/routers-stage3c.ts`; existing UI routes and AI procedures remain unchanged and can adopt these contracts incrementally.
- Added migration `drizzle/0002_zippy_alice.sql`; it was applied after a pre-migration database backup and verified by `pnpm drizzle-kit migrate`.
- Legacy AsyncStorage and local/domain persistence remain intact. The new server repositories are an additive multi-user boundary, not a destructive replacement.
- `rca_results` keeps historical rows and marks only the previous current row as superseded; evidence and chat records are append-only at repository level.

## 6. Known blockers and risks

- OpenRouter API connector is currently listed but disabled in the session configuration; no usable OpenRouter secret is available to the server yet.
- Free model IDs and availability change frequently. The registry must query pricing/capabilities at runtime instead of treating Qwen/DeepSeek slugs as permanent.
- OpenRouter free quotas/rate limits are provider-side and cannot be guaranteed by the application.
- Remote vision requires sending compressed media to the backend/provider; the UI must disclose this before upload.
- Existing local AI code must not be called from the web route after cutover, otherwise the app would violate the web-only requirement.

## 7. Acceptance evidence required

- TypeScript check passes.
- Existing and new unit tests pass.
- Web production export passes.
- API key is absent from frontend bundle.
- Paid model request is rejected by CostGuard in tests.
- Free quota/model unavailable returns a typed, user-readable error.
- Browser acceptance: create investigation → add photo → AI Analyze → validated RCA → cache → PDF export.
- Browser acceptance on Android Chrome and desktop Chrome.
