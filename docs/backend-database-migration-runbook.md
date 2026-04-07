# Backend and Database Migration Runbook

**Document status:** Baseline rollout guide  
**Last updated:** 2026-04-07 17:30:00 EDT
**Schema source of truth:** `docs/database_schema.md`  
**Product source of truth:** `docs/resume_builder_PRD_v3.md`

This runbook applies whenever backend or database work changes schema, compatibility, rollout order, backfills, retention, or post-deploy verification.

## Baseline Rules

- Update `docs/database_schema.md` before or alongside any schema migration.
- Keep PRD-visible behavior and status names aligned with schema and backend changes.
- Fail closed on missing auth, invalid data, missing configuration, and invalid AI validation output.
- Keep secrets and sensitive content out of migration logs, scripts, and verification output.
- Preserve explicit user scoping in all migration, backfill, and verification queries.

## Migration Workflow

1. Define the contract change in `docs/database_schema.md`.
2. Identify whether the change is additive, backfill-dependent, or destructive.
3. Choose a rollout order that keeps deployed code compatible with the live schema at each step.
4. Add or update RLS policies, indexes, and constraints as part of the same migration set.
5. Add a backfill step when existing rows need new defaults or derived values.
6. Update backend code to honor the new schema and guardrails.
7. Verify post-deploy behavior with focused checks on auth, ownership, status mapping, and failure recovery.

## Rollout Posture

### Additive changes

- Prefer additive migrations first: new nullable columns, new tables, new indexes, and new enum values.
- Deploy write paths only after the database can accept the new shape.
- Deploy read paths only after backfills or defaulting behavior make the new data safe to consume.

### Backfill-dependent changes

- Make the new schema compatible with both old and new code paths before backfilling.
- Backfill in bounded batches when row count or lock duration could become material.
- Treat partially completed backfills as an expected state and keep readers defensive until the backfill is complete.

### Destructive changes

- Do not combine destructive schema changes with the first deploy that stops writing the old shape.
- Stage destructive work behind a prior deploy that fully drains old reads and writes.
- Verify that no background jobs, exports, or notification paths still depend on the old shape before removal.

## Verification Checklist

- Authenticated users can read and write only their own rows after the migration.
- RLS policies still block cross-user access on every user-scoped table.
- Application visible statuses, internal states, and failure reasons remain aligned with the PRD.
- Existing base resumes, applications, drafts, and notifications still load correctly after any schema change.
- Applications with blank and populated `job_posting_origin` values both behave correctly, including `other` handling and duplicate-review fallback.
- Duplicate review, generation, regeneration, and export paths still preserve recoverable failure handling.
- No migration or verification step stores sensitive resume content, job descriptions, or tokens in logs.

## Backfill and Recovery Notes

- Prefer idempotent backfill scripts so retries are safe.
- Give every backfill and verification step a clear stop condition.
- Record how to detect partial completion before running any cleanup step.
- For failures, preserve enough diagnostic detail to recover without exposing sensitive user data.

## Current MVP Baseline

- The MVP schema contract is defined in `docs/database_schema.md`.
- The current plan assumes a single current `resume_drafts` row per application.
- Persistent PDF storage is out of scope for MVP.
- Dedicated async job/progress tables are deferred until implementation chooses the worker strategy.

## Current Additive Change Note: Job Posting Origin

- Introduce `applications.job_posting_origin` as a nullable normalized field and `applications.job_posting_origin_other_text` as a nullable conditional companion field.
- Deploy the additive schema before shipping any write path that persists the new origin values.
- No mandatory backfill is required for existing applications; historical rows may keep `NULL` origin values until a user or future tooling supplies them.
- Read paths and duplicate-review logic must stay compatible with mixed data while existing rows still have `NULL` origins.
- Post-deploy verification must confirm:
  - extraction can persist normalized origin values when known
  - manual entry and later edits can save the dropdown value and the `other` label safely
  - duplicate detection uses `job_posting_origin` when available and falls back to `job_title` + `company` when it is missing

## Current Implementation Note: Phase 0 Foundation

- The initial Phase 0 migration is implemented as repo-owned SQL under `supabase/migrations/`.
- Local development applies migrations through the Compose-managed `migration-runner` service instead of ad-hoc manual SQL execution.
- Local dev mode does not provide Supabase Auth invite or recovery emails; GoTrue email delivery is intentionally disabled and app-level email tests should use the backend Resend gate instead.
- Auth provisioning depends on the Phase 0 profile-sync trigger: inserts and email updates on `auth.users` must continue to create or align the matching `public.profiles` row.
- Post-deploy or post-reset verification for Phase 0 should confirm:
  - the schema migration applies before backend and PostgREST reads begin
  - profile sync runs for newly provisioned users
  - every documented user-scoped table has RLS enabled and owner-only policies present
  - the protected backend bootstrap endpoint can resolve a profile for an invited user without cross-user access

## Current Implementation Note: Phase 1 Intake and Duplicate Review

- Phase 1 ships without a new schema migration. It reuses the existing `applications` and `notifications` tables plus Redis-backed progress keys.
- `applications.duplicate_match_fields` now stores the surfaced duplicate signals and may include `job_posting_origin`, `job_url`, `reference_id`, or `job_description` when those signals materially contributed to the match.
- `notifications.action_required` must be treated as an active-attention flag. Resolution flows for manual entry and duplicate review should clear existing action-required rows for that application instead of leaving them active forever.
- Post-deploy verification for Phase 1 should confirm:
  - URL-based application creation immediately creates a draft row and redirects to the detail page
  - extraction progress polling updates while the worker runs and stops cleanly at success or failure
  - extraction success requires `job_title` and `job_description`, while missing `company` leaves the application recoverable and duplicate review deferred
  - duplicate detection can surface high-confidence matches from exact job links or extracted reference ids, not only title and company similarity
  - action-required notification badges clear after successful manual entry or duplicate dismissal

## Current Implementation Note: Phase 1A Blocked Recovery and Chrome Extension Intake

- Phase 1A adds the additive migration `supabase/migrations/20260407_000002_phase_1a_blocked_recovery_extension.sql`.
- `applications.extraction_failure_details` stores sanitized blocked-source diagnostics. Do not persist raw block-page HTML, challenge payloads, or IP-address text there.
- `profiles.extension_token_hash`, `profiles.extension_token_created_at`, and `profiles.extension_token_last_used_at` back the scoped Chrome extension import token. The plaintext token must never be stored in the database.
- Rollout order for Phase 1A:
  1. Apply the additive migration.
  2. Deploy backend and worker code that reads and writes the new columns.
  3. Deploy frontend blocked-recovery UI and extension onboarding.
  4. Load or publish the Chrome extension bundle separately.
- No backfill is required. Existing applications may keep `NULL` `extraction_failure_details`, and existing profiles may keep `NULL` extension-token fields until the feature is used.
- Post-deploy verification for Phase 1A should confirm:
  - blocked Indeed or Cloudflare-style pages transition to `manual_entry_required` with `failure_reason = extraction_failed` and sanitized failure details
  - pasted source-text recovery clears stale `extraction_failure_details` after successful recovery
  - extension token rotation invalidates the previous token immediately
  - extension imports create applications inside the authenticated owner boundary only

## Current Additive Change Note: Persisted Extracted Reference IDs

- Add the additive migration `supabase/migrations/20260407_000003_phase_1a_extracted_reference_id.sql`.
- `applications.extracted_reference_id` should be treated as a persisted extraction output, not as user-entered data.
- No backfill is required. Existing rows may keep `NULL` reference IDs and duplicate detection must continue to fall back to URL and description parsing for those rows.
- Post-deploy verification should confirm:
  - worker success callbacks persist `extracted_reference_id` when provided
  - duplicate detection can match two applications by the persisted reference ID even when their job URLs differ

## Current Implementation Note: Phase 2 Base Resumes and Profile Preferences

- Phase 2 adds the migration `supabase/migrations/20260407_000004_phase_2_base_resumes.sql`.
- This migration adds granular RLS policies for `base_resumes` and `resume_drafts` tables, replaces catch-all owner policies with per-operation policies, and adds a `user_id` index on `base_resumes`.
- No schema changes to table definitions were required; Phase 0 migration already created all Phase 2 tables (`base_resumes`, `resume_drafts`, `profiles` section-preference columns).
- No backfill is required. Existing rows use default section preferences until users modify them.
- Post-deploy verification for Phase 2 should confirm:
  - authenticated users can list, create, read, update, and delete only their own base resumes
  - setting a default base resume clears the previous default for that user
  - profile PATCH updates persist personal info and section preferences correctly
  - RLS policies enforce per-operation ownership on `base_resumes` and `resume_drafts`
