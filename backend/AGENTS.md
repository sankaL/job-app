# Backend — Agent Guidance

Keep this file focused on durable backend rules for the AI Resume Builder. Do not add setup commands, ports, env-var instructions, or speculative module maps.

## Source of Truth
- Product behavior and data contract: `docs/resume_builder_PRD_v3.md`

## Backend Commitments
- Follow the committed backend stack only: FastAPI, Custom JWT Auth, Postgres, Pydantic AI, OpenRouter, Playwright, Resend, and Railway.
- Keep backend responsibilities aligned with these product domains:
  - auth and session validation
  - applications
  - base resumes
  - resume drafts
  - notifications
  - profile and resume workbench structure
  - extraction
  - generation and regeneration
  - PDF export
- Keep route handlers narrow and move orchestration into dedicated services or jobs as implementation grows.

## Security and Data Isolation
- All application API routes require a valid backend-issued JWT (RS256). Do not add unauthenticated application endpoints beyond the login surface.
- Enforce per-user isolation on every read, write, background job, and notification path.
- Backend code must enforce explicit user scoping on every read, write, background job, and notification path, and repositories must establish the matching transaction-local Row-Level Security context. Treat RLS as defense in depth, not a substitute for ownership predicates.
- Fail closed on missing or invalid auth, permissions, config, job inputs, and validation outputs.
- Keep secrets, raw provider payloads, full resume drafts, and full job descriptions out of logs unless sanitized and strictly necessary.

## Workflow and State Rules
- Maintain explicit internal processing states and failure reasons as described in the PRD.
- Keep the mapping from internal processing states to visible statuses explicit in code.
- Extraction, generation, regeneration, and export failures must leave a recoverable user path and create the required notifications.
- Duplicate detection must run after successful extraction or successful manual entry, before generation proceeds.
- Keep the duplicate threshold configurable rather than hardcoded.
- Full regeneration overwrites the latest draft and updates generation timestamps; MVP does not include resume version history.
- PDF export must generate from the latest draft content at request time and must not persist generated PDFs for MVP.

## Async and Timeout Contract
- Extraction must enforce a `30s` boundary on the whole Playwright capture and a separate `45s` model budget in which the primary is capped at `30s`, with a hard per-job worker timeout, cancellation of stopped or stalled worker jobs, and backend recovery of stalled or never-started extraction jobs.
- Full resume generation and full regeneration must enforce a `240s` idle timeout with a `240s` maximum wall-clock window.
- Single-section regeneration must enforce a `120s` idle timeout with a `120s` maximum wall-clock window.
- PDF export must enforce a `20s` timeout.
- Background work must use bounded retries, explicit cancellation behavior, and clear terminal failure handling.
- OpenRouter models are chosen by role in `shared/model-config.json` (bundled as `app/core/model-config.json`; keep the copies identical). There are no model environment variables. Per-model output mode, reasoning bounds and provider routing (no data retention, latency sort, Gemini pinned to AI Studio) come from the same file. Bounded output correction, targeted section repairs and LLM audit escalations share a request, token and deadline budget.

## Generation and Validation Boundaries
- Initial generation and full regeneration write Professional Experience and the other writable sections in two concurrent structured requests, copy fixed facts locally, audit each group (Jev first, LLM escalation for uncertain claims), and repair only failed sections within the shared budget.
- Respect saved document inclusion/order, reviewed source-supported eligibility, target length, aggressiveness setting, and additional instructions where applicable.
- Strip personal and contact information from resume content before any external LLM call and reattach it locally after validation or formatting.
- Never generate personal information or invent credentials, employers, dates, or educational institutions. Only High aggressiveness may add plausible job-fit claims (technologies, scope, outcomes, metrics) beyond the source. Low aggressiveness keeps Professional Experience role titles source-exact. Medium may lightly reframe them only when the title stays grounded in the same core role family and seniority. High may retitle more freely only when the new title still matches the demonstrated work and keeps employer and dates unchanged.
- Initial generation, full regeneration, and section regeneration must consume the user's subscription quota. The legacy `full_regeneration_count` field is retained for compatibility only.
- Require reviewed source sections before generation. Preserve the exact source snapshot for comparison and section/keyword regeneration. Run deterministic schema and rule validation over generated content before assembly.
- Validator outcomes are limited to approve or fail.
- Validation failure must block assembly and follow the generation failure path defined by the PRD. The exception is initial generation and full regeneration: an individually unverifiable section keeps its original text with `generation_notice: kept_original_unverified`, the generation completes, and the backend clears the notice when the user edits that section. Usage events record `kept_original_sections`.
- Worker progress may carry bounded `partial_sections` (verified sections shown while generation continues). Progress reads must drop malformed or oversized values rather than fail. The worker publishes progress on the application event channel.
