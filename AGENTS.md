# AI Resume Builder — Agent Guidance

Keep agent instructions lean and durable:
- No setup, run, deploy, or troubleshooting commands
- No environment variable lists
- No speculative folder maps or implementation plans
- No unresolved engineering choices presented as settled guidance

Directory-specific guidance lives in:
- `frontend/AGENTS.md`
- `backend/AGENTS.md`
- `agents/AGENTS.md`

## Repo Shape
- `frontend/` — React client for authentication, applications, resume editing, notifications, and export initiation
- `backend/` — FastAPI API and background workflows for extraction, generation, validation, notifications, and export
- `agents/` — AI orchestration assets and prompt-layer guidance for generation and validation workflows
- `docs/` — product requirements and other source-of-truth documentation
- `supabase/` — Supabase-related project assets

When behavior conflicts with assumptions or older guidance, follow the PRD and update any stale agent instructions in the same task.

## Global Product Rules
- This is a private, invite-only application. Do not introduce public signup flows in MVP work.
- All application data is private to the authenticated user. Treat user isolation as a hard requirement across UI, API, background work, and notifications.
- All resume content is stored as Markdown. Base resumes and generated drafts remain editable as Markdown.
- Personal information such as name, email, phone, and address comes from the user profile and must not be invented by the LLM.
- Resume tailoring must stay grounded in the user's source resume and the job posting. Do not invent employers, dates, credentials, or education history. High aggressiveness may retitle Professional Experience role names only when the new title remains a truthful reframing of the same source role and keeps employer and dates unchanged.
- The `applied` flag is separate from the primary application status and must remain independently user-controlled.
- Exported PDFs are generated on demand from the latest draft. Do not add persistent PDF storage for MVP.

## Security and Reliability Guardrails
- Fail closed on missing or invalid auth, permissions, config, preconditions, or AI validation output.
- Do not expose unauthenticated application APIs beyond the login surface.
- Do not store auth tokens in browser `localStorage`.
- Keep secrets and sensitive user content out of logs. Do not log tokens, raw provider payloads, full resume content, or full job descriptions unless strictly required and sanitized.
- Do not swallow failures. Return sanitized errors, record enough context for diagnosis, and surface recoverable next steps to the user.
- All async work must have explicit timeout boundaries, bounded retries, and clear stop conditions.

## Workflow Expectations
- Keep the user-visible status model aligned with the PRD: `Draft`, `Needs Action`, `In Progress`, `Complete`.
- Provide clear user feedback for async operations with progress, success, error, and attention states.
- Preserve recoverable paths for extraction, generation, regeneration, and export failures.
- Keep instructions scoped to committed product behavior and stack choices only. Do not encode unresolved tooling or architecture decisions here.

## Sources of Truth (consult before changing behavior)
- Product contract: `docs/resume_builder_PRD_v3.md`
- Database schema source of truth: `docs/database_schema.md`
- Backend/database migration runbook: `docs/backend-database-migration-runbook.md`
- Task tracking: `docs/build-plan.md`
- Decisions log: `docs/decisions-made/`
- Task implementation notes: `docs/task-output/`

## Global Guardrails (non-negotiables)
- **Fail closed** on missing or invalid auth, config, preconditions, or AI output validation.
- **No secrets or sensitive user data in logs.** Do not log auth tokens, provider credentials, raw provider payloads, or unnecessary transcript/task content.
- **Never store auth tokens in browser localStorage.**
- **No silent failures.** Do not swallow exceptions; return sanitized errors and keep enough context for diagnosis.
- **Explicit user scoping everywhere.** Reads, writes, reminders, and background work must operate on the authenticated user's data only.
- **Bounded async behavior.** Retries, polling, and external calls must have timeouts/backoff and clear stop conditions.
- **Cleanup resources.** Every listener, timer, subscription, recorder, and background handle must be cleaned up.
- **No production debug leftovers.** Avoid ad-hoc console/stdout logging in production paths.
- **Regression safety.** Behavior changes and bug fixes should add or adjust tests once the corresponding test surface exists.

## Change Checklists

### Local Development / Testing
- Local testing must support a dedicated environment feature flag in the env files that switches the app into **dev mode**.
- In dev mode, testing must use the **Makefile-managed local stack**, not hosted production services.
- Dev mode should bring up local Dockerized services needed for testing.
- Do **not** connect local testing flows to production Supabase Auth or the production Supabase database.
- When implementing or validating local test workflows, prefer the Makefile entrypoints as the source of truth over ad-hoc manual startup steps.

### Schema / Data Contract Changes
- Treat `docs/database_schema.md` as the schema source of truth.
- If a change affects schema, compatibility, rollout order, migrations, backfills, retention, or post-deploy verification, update `docs/backend-database-migration-runbook.md` in the same task.
- Keep product and architecture docs in sync when a change affects capture flow, task semantics, reminders, recurrence, timezone handling, or auth/session behavior.

### AI / Capture Behavior Changes
- Application behavior must stay aligned with `docs/resume_builder_PRD_v3.md`.
- If any functional behaviour or AI behavior changes, do:
  - update the relevant product or architecture docs
  - add or adjust regression coverage where the codebase supports it
  - record the rationale in the decisions log
  - **CRITICAL**: If agent logic changes (generation, validation, extraction, or any AI orchestration logic), update `docs/prompts.md` with the new prompt structure, parameters, and behavioral changes in the same task.

### Task Completion Bookkeeping
After completing a task:
1. Update `docs/build-plan.md` with status and timestamp.
2. Update `docs/decisions-made/` only when the task includes a **major decision** or a **major task** worth recording.
3. Update `docs/task-output/` only for a **major task**.
4. Ask me if you are not sure if this is a major task or decision.

### Decision Log File Management
- Decision log files should use the sequence format `decisions-made-1.md`, `decisions-made-2.md`, `decisions-made-3.md`, and so on.
- Write new entries at the **top** of the latest numbered decision log file.
- If the latest decision log file exceeds roughly **1000 lines**, create the next file in sequence and write the new entry there.

## General Behaviour (CRITICAL)
It is okay to say "I don't know" or "I am not sure" when uncertainty is real.
Always tell me how confident you are in your answer (in percentage) and what information would increase confidence.
