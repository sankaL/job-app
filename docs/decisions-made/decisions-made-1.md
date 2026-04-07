# Decisions Made

## 2026-04-07 17:30:00 EDT — Phase 2 — File Format and LLM Cleanup Decisions

- Status: Accepted
- Context: Phase 2 needed concrete decisions for resume file ingestion and optional LLM post-processing before the base resume management and profile surfaces could be implemented without leaving open design gaps.
- Decisions:
  1. PDF-only resume upload for MVP (using pdfplumber). .docx support deferred to reduce scope.
  2. Optional LLM cleanup pass via direct OpenRouter API call (httpx) rather than LangChain. LangChain integration deferred to Phase 3 generation pipeline.
  3. OpenRouter cleanup model defaults to openai/gpt-4o-mini with 30-second timeout. Cleanup failures are non-blocking — raw parsed Markdown is returned on any error.
- Rationale: Keep Phase 2 focused on data management and configuration setup. PDF is the most common resume format. Direct OpenRouter call avoids premature LangChain dependency.
- Consequences: The resume upload path now accepts only `.pdf` files, the backend makes a best-effort LLM cleanup call with graceful fallback, and Phase 3 will introduce LangChain for generation rather than retrofitting it into the upload pipeline.

## 2026-04-07 15:30:43 EDT — Add blocked-source recovery and Chrome extension intake as the Phase 1A follow-on

- Status: Accepted
- Context: Phase 1 left extraction failures recoverable through retry and manual entry, but hostile job sites can return block pages instead of postings, and the product needed a compliant way to ingest job content from a user-controlled browser session without introducing a separate extension sign-in flow.
- Decision: Detect blocked pages explicitly before LLM extraction, persist sanitized blocked-source diagnostics on the application, and route recovery through pasted-text retry first and manual entry second. Add a Chrome-only Manifest V3 extension that captures current-tab content, creates new applications through a token-protected import endpoint, and receives its scoped token from the authenticated web app rather than storing Supabase session credentials.
- Consequences: The schema now needs additive storage for `applications.extraction_failure_details` and revocable hashed extension tokens on `profiles`. The detail page becomes the blocked-source recovery surface, the worker must classify block pages deterministically, and extension imports stay inside the existing per-user ownership boundary without expanding the public auth surface.

## 2026-04-07 13:15:06 EDT — Lock the Phase 1 extraction and per-agent model configuration contract

- Status: Accepted
- Context: Phase 1 needed concrete extraction behavior and a stable environment-variable contract for multiple AI agents before the worker, backend callback flow, duplicate review, and frontend recovery states could be implemented without leaving open design gaps.
- Decision: Implement extraction as a hybrid pipeline that captures deterministic page context with Playwright, sends that context to an OpenRouter-backed extraction agent for structured output, and accepts automatic extraction only when `job_title` and `job_description` validate successfully. Keep `company` optional at extraction time, defer duplicate review until company exists, and score duplicates with additional URL, reference-id, origin, and description context instead of title-company similarity alone.
- Model-config decision: Use one shared `OPENROUTER_API_KEY` plus explicit primary and fallback model environment variables per agent. Phase 1 wires the extraction agent now and reserves the same pattern for generation, validation, and future agents.
- Consequences: The worker now owns Playwright capture plus LLM extraction, the backend keeps workflow state and duplicate decisions, extraction failure cleanly falls back to manual entry, and future AI agents can be added without reworking the model configuration surface.

## 2026-04-07 12:06:48 EDT — Simplify the local env contract and separate app email from local auth email

- Status: Accepted
- Context: The initial Phase 0 stack exposed duplicated frontend, backend, worker, and local GoTrue mailer variables through the root env file even though local development only needs a small user-edited surface. The product requirement for Resend applies to app notifications, not to self-hosted local Supabase Auth delivery.
- Decision: Make the root `.env.compose` contract canonical, collapse repeated runtime toggles into shared root values, disable local GoTrue email delivery in dev mode, and reserve app-level email configuration for `EMAIL_NOTIFICATIONS_ENABLED`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- Consequences: Local testing no longer depends on user-supplied SMTP or Mailpit variables, app email sending is explicitly gated in the backend, and developers only edit the reduced root env contract for normal Compose-based work.

## 2026-04-07 11:36:08 EDT — Lock Phase 0 foundation choices for implementation

- Status: Accepted
- Context: Phase 0 required concrete decisions for the local development stack, background job baseline, initial progress-delivery contract, and frontend auth persistence before code could be scaffolded without leaving major implementation gaps.
- Decision: Implement the local stack as a repo-owned Docker Compose workflow, use ARQ + Redis as the background job baseline, standardize initial progress delivery around polling, and persist frontend Supabase sessions in `sessionStorage` rather than `localStorage`.
- Consequences: The committed foundation now centers on a single root Compose + Makefile workflow, a runnable ARQ worker container, a shared polling-progress contract, and a frontend auth client that avoids browser `localStorage`. Future phases can add extraction and generation behavior without re-deciding the infrastructure baseline.

## 2026-04-07 10:00:16 EDT — Normalize job posting origin on applications

- Status: Accepted
- Context: Application intake previously relied on extracted or manually entered job title, company, and job description, while duplicate review compared only title and company. That left no structured way to record where a posting came from and made duplicate warnings less precise for postings that appear across multiple boards.
- Decision: Add a nullable normalized `job_posting_origin` field to applications, with fixed MVP values for common sources and a conditional free-text companion field when the user selects `Other`. Automatic extraction should classify the origin when confidence is sufficient; otherwise the user can provide or edit it later from manual entry or the application detail page.
- Duplicate-review rule: Consider `job_posting_origin` during duplicate evaluation when both compared applications have it populated, but do not require it. If origin is missing on either side, fall back to the existing title-and-company duplicate check.
- Consequences: The PRD, schema contract, migration runbook, and roadmap now treat posting origin as a first-class application field. Existing rows do not require a backfill and may remain `NULL` until a user or later tooling supplies the value.
