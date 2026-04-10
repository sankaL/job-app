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
- Full resume generation and full regeneration must enforce a `240s` idle timeout with a `240s` maximum wall-clock window.
- Single-section regeneration must enforce a `120s` idle timeout with a `120s` maximum wall-clock window.
- PDF export must enforce a `20s` timeout.
- Background work must use bounded retries, explicit cancellation behavior, and clear terminal failure handling.
- OpenRouter integration must support a configurable primary model and configurable fallback model, with one retry against the fallback only after primary-model failure or invalid structured output.

## Generation and Validation Boundaries
- Initial generation and full regeneration must use one LLM request that returns structured JSON for all enabled sections in order.
- Respect the user's enabled sections, section order, target length, aggressiveness setting, and additional instructions where applicable.
- Strip personal and contact information from resume content before any external LLM call and reattach it locally after validation or formatting.
- Never generate personal information or invent credentials, employers, dates, or educational institutions. High aggressiveness may retitle Professional Experience role names only when the new title remains a truthful reframing of the same source role and keeps employer and dates unchanged.
- Full regeneration must enforce a per-application cap of three queued attempts for non-admin users; admin users bypass the cap.
- Run deterministic schema and rule validation over generated content before assembly.
- Validator outcomes are limited to approve or fail.
- Validation failure must block assembly and follow the generation failure path defined by the PRD.
