# LangSmith tracing and shared Unslop policy

**Completed:** 2026-08-22 20:59:22 EDT
**Scope:** Add privacy-aware LangSmith tracing to every LLM capability and apply the exact shared Unslop instruction to every model system prompt.

## Delivered

- Added opt-in LangSmith configuration to the backend and worker. Local and unset environments default to `LANGSMITH_TRACING=false`; enabled mode requires `LANGSMITH_PROJECT` and `LANGSMITH_API_KEY`.
- Added stable trace roots for extraction, keyword extraction, generation, full and section regeneration, keyword optimization, Resume Judge, and upload cleanup. Model attempts, validation and repair, and deterministic assembly appear as child runs.
- Added safe attempt metadata for model, transport, primary or fallback status, reasoning effort, timeout, and retry reason.
- Added trace-only redaction for contacts, credentials, URL query secrets, user ids, personal information, and callback data. Workflow roots store safe summaries rather than raw arguments.
- Traced the backend's direct OpenRouter cleanup call after contact removal and attached its sanitized result plus numeric provider usage.
- Added the exact 6,509-character Unslop instruction to extraction, keyword extraction, every resume-writing variant, validation repair, Resume Judge, and cleanup. Operation-specific constraints take precedence.
- Added an exact SHA-256 and cross-service parity test for the mirrored prompt policy.
- Updated the PRD, prompt catalog, decision log, environment examples, Compose contract, dependencies, and build plan.

## Verification

- Agent tests: `154 passed`
- Backend tests: `305 passed`, with one existing short-test-key warning
- Python syntax compilation: passed
- `git diff --check`: passed
- Docker Compose configuration validation: passed
- Live LangSmith ingestion was not run because no project credentials were supplied. Production remains untraced until both Railway services receive the enabled flag, project name, and API key.
