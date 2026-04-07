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

## Source of Truth
- Product contract: `docs/resume_builder_PRD_v3.md`

When behavior conflicts with assumptions or older guidance, follow the PRD and update any stale agent instructions in the same task.

## Global Product Rules
- This is a private, invite-only application. Do not introduce public signup flows in MVP work.
- All application data is private to the authenticated user. Treat user isolation as a hard requirement across UI, API, background work, and notifications.
- All resume content is stored as Markdown. Base resumes and generated drafts remain editable as Markdown.
- Personal information such as name, email, phone, and address comes from the user profile and must not be invented by the LLM.
- Resume tailoring must stay grounded in the user's source resume and the job posting. Do not invent employers, titles, dates, credentials, or education history.
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
