# Photo Agent — implementation handoff

## Scope
- Added a dedicated server-side Photo Agent for still-image evidence.
- Accepts JPEG, PNG and WebP data URLs; max 10 photos, 7 MB per image and 24 MB combined.
- Uses the existing explicit `vision` free-model allowlist and `callFreeProvider`; no paid provider path is introduced.
- Analyzes each image separately so the server binds every normalized finding to the exact evidence reference rather than trusting a model-generated filename.
- Returns visible facts, possible defects, hypotheses, missing data, recommended checks and visual confidence.
- Photo Agent findings are added to the RCA context before Video Agent, Document Agent, Technical Expert and Analyst.
- Raw photo image payloads are no longer duplicated into the Analyst request by the RCA router.
- Added a `photo` diagnostic pipeline stage.

## Validation added
- `tests/photo-agent.test.ts`: free vision route, exact evidence reference, invalid payload, image-count limit and invalid model output.
- `tests/rca-orchestrator.test.ts`: Photo Agent integration and preservation of Photo findings when Video Agent also runs.
- `tests/transport.test.ts`: `photo` pipeline-stage diagnostics.

## Remaining validation
The source archive provided to this work has no `node_modules`; full Vitest, project typecheck, lint and Android build have not been run. A TypeScript `transpileModule` syntax check passed for all modified TypeScript files. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm lint` and Android `assembleRelease` in the connected build environment before release.
