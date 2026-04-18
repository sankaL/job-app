# Backend and Database Migration Runbook

**Document status:** Baseline rollout guide  
**Last updated:** 2026-04-17
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

## Current Implementation Note: Phase 3 Generation Pipeline

- Phase 3 adds the migration `supabase/migrations/20260407_000005_phase_3_generation.sql`.
- This migration adds `applications.generation_failure_details jsonb` to store generation and validation failure diagnostics (message and optional validation_errors array).
- Rollback: `ALTER TABLE public.applications DROP COLUMN IF EXISTS generation_failure_details;`
- No backfill is required. Existing applications keep `NULL` generation failure details until generation is attempted.
- Post-deploy verification for Phase 3 should confirm:
  - generation success clears `generation_failure_details` and transitions the application to `in_progress` / `resume_ready`
  - generation or validation failure persists structured failure details and transitions to `needs_action` / `generation_failed`
  - the draft is created or updated in `resume_drafts` with generation params and sections snapshot
  - in-app and email notifications fire for generation outcomes

## Current Additive Change Note: Generation Timeout and Cancellation Failure Reasons

- Add the additive migration `supabase/migrations/20260407_000006_phase_4_generation_failure_reasons.sql`.
- This migration extends `failure_reason_enum` with `generation_timeout` and `generation_cancelled` so backend cancel and timeout recovery paths remain schema-compatible.
- Rollout order for this change:
  1. Apply the additive enum migration.
  2. Deploy backend and worker code that emits the expanded generation failure reasons and the nested worker callback payloads.
  3. Deploy the frontend generation-state handling fixes so failed `generation_pending` rows render retry UI instead of active progress.
- No backfill is required. Existing applications may keep prior `generation_failed` values.
- Post-deploy verification should confirm:
  - cancelling an active generation returns a retryable application state instead of a `500`
  - a timed-out generation persists `failure_reason = generation_timeout` with user-safe message text
  - stale worker callbacks do not overwrite a cancelled or timed-out application because terminal progress uses a new job id

## Current Additive Change Note: Application Compensation Text

- Add the additive migration `supabase/migrations/20260409_000007_phase_4_application_compensation_text.sql`.
- `applications.compensation_text` stores raw compensation text exactly as shown in the posting or manual entry. It is intentionally nullable and unnormalized for MVP.
- Rollout order for this change:
  1. Apply the additive column migration.
  2. Deploy backend and worker code that reads and writes `compensation_text`.
  3. Deploy the frontend detail-page field and compact aggressiveness-help UI.
- No backfill is required. Existing applications may keep `NULL` `compensation_text`, and older rows may keep shorter historical `job_description` values until users retry extraction or edit them manually.
- Read paths and duplicate-detection logic must stay compatible with mixed rows where `compensation_text` is still null.
- Post-deploy verification should confirm:
  - extraction persists the full posting body in `job_description` when present, including lower-page sections like qualifications
  - extraction persists `compensation_text` only when compensation is clearly present in the posting
  - manual entry and detail-page edits can save `compensation_text` without affecting duplicate-review behavior

## Current Additive Change Note: Application Job Location Text

- Add the additive migration `supabase/migrations/20260409_000009_phase_4_application_job_location_text.sql`.
- `applications.job_location_text` stores raw location or hiring-region text exactly as shown in the posting or manual entry. It is intentionally nullable and unnormalized for MVP.
- Rollout order for this change:
  1. Apply the additive column migration.
  2. Deploy backend and worker code that reads and writes `job_location_text`.
  3. Deploy the frontend detail-page field so users can review and edit extracted location text.
- No backfill is required. Existing applications may keep `NULL` `job_location_text` until users retry extraction or edit them manually.
- Read paths and duplicate-detection logic must stay compatible with mixed rows where `job_location_text` is still null.
- Post-deploy verification should confirm:
  - extraction persists `job_location_text` only when the posting clearly states where the role is located, based, or hireable
  - extraction can separate `job_location_text` and `compensation_text` semantically even when they appear on the same rendered line
  - manual entry and detail-page edits can save `job_location_text` without affecting duplicate-review behavior

## Current Additive Change Note: Profile LinkedIn and Export Header Normalization

- Add the additive migration `supabase/migrations/20260409_000008_phase_4_profile_linkedin_for_export.sql`.
- `profiles.linkedin_url` stores an optional LinkedIn URL that stays inside the app boundary and is used only for local resume assembly and PDF export.
- Existing `profiles.address` storage remains unchanged, but export now treats it as the short location line in the resume header rather than a mailing-address-specific contract.
- No backfill is required. Existing profiles may keep `NULL` `linkedin_url`, and existing drafts may keep older header shapes until they are regenerated or normalized during export.
- Rollout order for this change:
  1. Apply the additive `linkedin_url` migration.
  2. Deploy backend and worker code that assembles or exports the profile-driven header with the new field and the stricter profile-name requirement.
  3. Deploy the frontend profile form changes so users can save location text and LinkedIn directly.
- Post-deploy verification should confirm:
  - profile GET and PATCH return `linkedin_url` correctly for authenticated owners only
  - initial generation, full regeneration, and PDF export fail closed with actionable guidance when profile `name` is blank
  - PDF export produces one normalized header only and uses the stored draft `page_length` target to tighten layout when pagination overflows

## Current Additive Change Note: Invite Onboarding, Admin Controls, and Usage Metrics

- Add the additive migration `supabase/migrations/20260410_000010_phase_5_invites_admin_metrics.sql`.
- This migration adds:
  - profile fields `first_name`, `last_name`, `is_admin`, `is_active`, and `onboarding_completed_at`
  - `user_invites` table plus `invite_status_enum`
  - `usage_events` table plus `usage_event_status_enum`
- Rollout order for this change:
  1. Apply the additive migration.
  2. Deploy backend invite/admin APIs, Supabase admin provisioning integration, and usage-event writes.
  3. Deploy frontend invite signup page and admin dashboard/user-management screens.
- No backfill is required. Existing users remain active and non-admin by default unless promoted through config or admin actions.
- Read paths and admin metrics must stay compatible while `usage_events` is still sparse immediately after rollout.
- Post-deploy verification should confirm:
  - admin invite creation pre-provisions Supabase Auth users, creates pending invite rows, and sends Resend emails
  - invite preview and accept flows enforce token validity, expiry, email match, and password policy
  - invite acceptance marks `user_invites.status = accepted` and sets `profiles.onboarding_completed_at`
  - deactivated users are blocked from authenticated bootstrap and extension-token issuance
  - admin metrics endpoints return coherent totals for invites and workflow operations without exposing cross-user private content

## Current Additive Change Note: Full Regeneration Cap and Deterministic Regeneration Hardening

- Add the additive migration `supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql`.
- This migration adds `applications.full_regeneration_count integer not null default 0` with a non-negative check constraint.
- Rollout order for this change:
  1. Apply the additive migration.
  2. Deploy backend service changes that enforce a non-admin cap of three full regenerations per application, with admin bypass.
  3. Deploy agents and worker changes for deterministic Professional Experience normalization and validation plus updated timeout and progress-stage messaging.
  4. Deploy frontend handling that surfaces the conflict-path contact-admin guidance.
- No backfill is required. Existing rows default to `0`.
- Post-deploy verification should confirm:
  - successful queueing of full regeneration increments `full_regeneration_count` for non-admin users
  - non-admin users are blocked once count reaches `3` with user-safe guidance to contact an administrator
  - admin users can queue full regeneration when count is already `3` or greater
  - queue failures do not consume a full-regeneration slot
  - stalled-job recovery and worker timeouts match the `240s` full-generation/full-regeneration and `120s` section-regeneration contract

## Current Additive Change Note: Resume Judge Result Persistence

- Add the additive migration `supabase/migrations/20260417_000012_phase_5_resume_judge_result.sql`.
- This migration adds `applications.resume_judge_result jsonb` to store the latest Resume Judge lifecycle state and score for the current draft.
- Rollout order for this change:
  1. Apply the additive migration.
  2. Deploy backend and worker code that queues Resume Judge jobs, persists queued/running/succeeded/failed states, and ignores stale callbacks using `evaluated_draft_updated_at`.
  3. Deploy frontend score-tile and breakdown-dialog UI that reads `resume_judge_result` directly from the application payload.
- No backfill is required. Existing applications may keep `NULL` `resume_judge_result` until a new generation, regeneration, or manual judge run occurs.
- Read paths must stay compatible with mixed rows where:
  - no judge result exists yet
  - a judge result exists for an older draft and must be treated as stale
  - a judge result predates the `run_attempt_count` JSON contract and must default safely without breaking rerun caps for newer writes
  - the last judge attempt failed but the application remains exportable and editable
- Post-deploy verification should confirm:
  - initial generation, full regeneration, and section regeneration queue Resume Judge only after the new draft persists successfully
  - stale judge callbacks do not overwrite scores for newer edited drafts
  - `resume_judge_result` never changes `visible_status`, `failure_reason`, or export availability
  - manual `POST /api/applications/{id}/judge` enqueues a fresh run for an existing ready draft
  - manual `POST /api/applications/{id}/judge` stops accepting reruns after three queued attempts for the same draft
