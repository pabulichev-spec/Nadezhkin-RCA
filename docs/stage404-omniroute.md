# Stage 404 — OmniRoute free-only integration

## Decision

PumpRCA uses OmniRoute as the primary server-side AI gateway when all of these server-only settings are present:

- `OMNIROUTE_ENABLED=true`
- `OMNIROUTE_ZERO_COST_CONFIRMED=true`
- `OMNIROUTE_BASE_URL`
- `OMNIROUTE_API_KEY`
- `OMNIROUTE_FREE_MODELS` — comma-separated explicit free route/model allowlist

The client never receives or supplies these values. Android/local AI, AsyncStorage, `.pumprca`, PDF format, ACL, and authorization are not changed by this integration.

## Routing policy

`server/ai/provider-router.ts` tries each allowlisted OmniRoute route first. A route is cooled down after provider, model, invalid-response, or quota errors. The fallback is the existing OpenRouter gateway, which independently applies model registry capability checks and `ZERO_COST_ONLY`/CostGuard. No paid or unknown route is selected. If neither gateway has an eligible free route, the request fails safely.

The application does not treat OmniRoute's published aggregate free-token estimate as a guarantee. Provider accounts, quotas, regional eligibility, terms, and billing behavior remain external prerequisites. Trial credits are not enabled by default and are not used unless a provider's no-auto-billing and hard-stop terms have been independently confirmed by the operator.

## Multi-agent RCA

When `PUMPRCA_MULTI_AGENT_ENABLED=true`, `rca.analyze` runs a bounded sequential pipeline through the same provider router:

1. Video Agent analyzes extracted frames and emits timestamped visual observations when video is attached.
2. Document Agent extracts documented facts, measurements, events, and missing data when supported files are attached.
3. Technical Expert provides a pump-focused engineering assessment, evidence-linked technical facts, possible failure mechanisms, diagnostic checks, required measurements, and safety precautions. Failure mechanisms remain hypotheses.
4. Analyst consolidates evidence into `FACT`, `SYMPTOM`, `HYPOTHESIS`, and `MISSING_DATA`.
5. Independent Critic checks provenance, contradictions, and missing data.
6. Composer creates the existing PumpRCA structured result.

The composer is validated by the existing RCA validator. It receives at most one bounded retry. Invalid results are not saved. The existing investigation ACL is checked before the provider call and the validated result is saved through the existing repository boundary.

## Evidence basis

OmniRoute is MIT-licensed and exposes an OpenAI-compatible `/v1/chat/completions` endpoint. Its own documentation states that free capacity depends on separately connected third-party accounts and provider limits, and may be zero on a fresh installation. Therefore PumpRCA requires an explicit free-model allowlist and zero-cost confirmation rather than assuming that every OmniRoute route is free.

Sources:

- https://github.com/cheaper-inference/OmniRoute
- https://github.com/cheaper-inference/OmniRoute/blob/release/v3.8.53/LICENSE
- https://github.com/cheaper-inference/OmniRoute/blob/release/v3.8.53/SECURITY.md
- https://github.com/cheaper-inference/OmniRoute/blob/release/v3.8.53/docs/reference/FREE_TIERS.md
