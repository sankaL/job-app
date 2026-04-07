# Decisions Made

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
