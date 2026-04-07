# Backend — Agent Guidance

Keep this file focused on durable backend rules for the AI Resume Builder. Do not add setup commands, ports, env-var instructions, or speculative module maps.

## Source of Truth
- Product behavior and data contract: `docs/resume_builder_PRD_v3.md`

## Backend Commitments
- Follow the committed backend stack only: FastAPI, Supabase Auth, Postgres, LangChain, OpenRouter, Playwright, Resend, and Railway.
- Keep backend responsibilities aligned with these product domains:
  - auth and session validation
  - applications
  - base resumes
  - resume drafts
  - notifications
  - profile and section preferences
  - extraction
  - generation and regeneration
  - PDF export
- Keep route handlers narrow and move orchestration into dedicated services or jobs as implementation grows.

## Security and Data Isolation
- All application API routes require a valid Supabase JWT. Do not add unauthenticated application endpoints beyond the login surface.
- Enforce per-user isolation on every read, write, background job, and notification path.
- Treat Supabase RLS as required defense in depth, not as a reason to skip explicit user scoping in backend logic.
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
- Extraction must enforce a `30s` timeout.
- Full resume generation must enforce a `90s` timeout.
- Single-section regeneration must enforce a `45s` timeout.
- PDF export must enforce a `20s` timeout.
- Background work must use bounded retries, explicit cancellation behavior, and clear terminal failure handling.
- OpenRouter integration must support a configurable primary model and configurable fallback model, with one retry against the fallback after primary-model failure.

## Generation and Validation Boundaries
- Generation is section-based. Each enabled section is generated independently so it can be regenerated independently later.
- Respect the user's enabled sections, section order, target length, aggressiveness setting, and additional instructions where applicable.
- Never generate personal information or invent credentials, employers, titles, dates, or educational institutions.
- Run a validator gate over generated content before assembly.
- Validator outcomes are limited to approve, auto-correct for minor structural issues, or fail.
- Validation failure must block assembly and follow the generation failure path defined by the PRD.
