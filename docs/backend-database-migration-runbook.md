# Backend and Database Migration Runbook

**Document status:** Baseline rollout guide  
**Last updated:** 2026-06-30
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
4. Add or update application-enforced ownership safeguards, indexes, and constraints as part of the same migration set.
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
- Backend reads and writes still scope every user-owned table by authenticated `user_id`.
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

### 2026-06-24 resume length diagnostics metadata

- No database schema migration or backfill is required. The change adds optional count-only `length_diagnostics` objects inside existing JSON metadata surfaces.
- Existing `usage_events.metadata` rows without `details.length_diagnostics` remain valid and readers must keep treating the field as optional.
- Post-deploy verification should confirm:
  - generation and regeneration success activity can include generated word count, source word count, target range, and minimum acceptable words
  - validation failure activity preserves the same safe count diagnostics without raw resume or job text
  - older application activity rows still render normally when the diagnostics object is absent

### 2026-06-07 nullable application source URLs

- Migration `20260607_000016_allow_nullable_application_job_url.sql` makes `applications.job_url` nullable and preserves the non-blank constraint only when a URL is present.
- No backfill is required. Existing applications keep their current source URLs; new pasted-description-only applications may store `NULL`.
- Rollback requires either deleting URL-less application rows or backfilling valid source URLs before restoring `job_url NOT NULL` and `CHECK (btrim(job_url) <> '')`.
- Post-deploy verification:
  - URL-only application creation still queues URL extraction.
  - URL plus pasted-description creation still queues capture-backed extraction with the URL attached.
  - Pasted-description-only creation stores `job_url = NULL`, queues capture-backed extraction, and does not render broken source links.
  - Duplicate detection does not treat two missing URLs as an exact URL match.

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
- Local dev mode does not send invite or recovery emails; app-level email tests should use the backend Resend gate instead.
- When `APP_DEV_MODE=true`, the login surface accepts an email-only local sign-in and protected routes restore an existing session only after a refresh-cookie-backed auth check succeeds.
- Auth provisioning is repo-owned: `public.users` stores credentials, `public.refresh_tokens` stores refresh-token hashes, and profile rows are created or aligned by backend code instead of `auth.users` triggers.
- Post-deploy or post-reset verification for Phase 0 should confirm:
  - the schema migration applies before backend reads begin
  - migrated or newly provisioned users exist in `public.users` before authenticated bootstrap runs
  - every documented user-scoped table is read and written through explicit backend `user_id` scoping
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
- This migration is now a no-op because per-user ownership is enforced in backend code rather than database RLS policies.
- No schema changes to table definitions were required; Phase 0 migration already created all Phase 2 tables (`base_resumes`, `resume_drafts`, `profiles` section-preference columns).
- No backfill is required. Existing rows use default section preferences until users modify them.
- Post-deploy verification for Phase 2 should confirm:
  - authenticated users can list, create, read, update, and delete only their own base resumes
  - setting a default base resume clears the previous default for that user
  - profile PATCH updates persist personal info and section preferences correctly
  - backend ownership checks continue to enforce per-user access on `base_resumes` and `resume_drafts`

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
  2. Deploy backend invite/admin APIs, repo-owned user provisioning/password management, and usage-event writes.
  3. Deploy frontend invite signup page and admin dashboard/user-management screens.
- No backfill is required. Existing users remain active and non-admin by default unless promoted through config or admin actions.
- Read paths and admin metrics must stay compatible while `usage_events` is still sparse immediately after rollout.
- Post-deploy verification should confirm:
  - admin invite creation pre-provisions app-owned users, creates pending invite rows, and sends Resend emails
  - invite preview and accept flows enforce token validity, expiry, email match, and password policy
  - invite acceptance marks `user_invites.status = accepted` and sets `profiles.onboarding_completed_at`
  - deactivated users are blocked from authenticated bootstrap and extension-token issuance
  - admin metrics endpoints return coherent totals for invites and workflow operations without exposing cross-user private content

## Current Additive Change Note: Subscription Tiers and Monthly Generation Quotas

- Add the additive migration `supabase/migrations/20260523_000013_subscription_tiers_generation_quotas.sql`.
- This migration adds:
  - `subscription_tiers` with seeded `basic` and `pro` rows
  - `profiles.subscription_tier text not null default 'basic'`
  - `resume_generation_usage` keyed by `user_id` and UTC `period_start`
- Rollout order for this change:
  1. Apply the additive migration and seed tier defaults.
  2. Deploy backend admin tier APIs, user tier assignment, and quota reservation/release logic before queueing resume-writing jobs.
  3. Deploy worker support for job-supplied primary/fallback generation models while preserving env fallback behavior for older queued jobs.
  4. Deploy frontend admin subscription settings, user-tier editing, and quota-exhausted error guidance.
- No explicit backfill script is required. Existing profiles receive `basic` through the column default/backfill in the migration.
- Queue failures must release any reserved monthly generation slot so failed enqueue attempts do not consume quota.
- The legacy `applications.full_regeneration_count` column remains for compatibility only. Monthly subscription usage supersedes it for initial generation, full regeneration, and section regeneration.
- Post-deploy verification should confirm:
  - `basic` and `pro` tiers exist with the expected default limits and model IDs
  - existing and newly invited users resolve to `profiles.subscription_tier = basic` unless changed by an admin
  - admins can read and update tier limits/model IDs, and can assign users to Basic or Pro
  - initial generation, full regeneration, and section regeneration reserve quota in the same UTC month bucket
  - quota exhaustion returns a sanitized `quota_exhausted` response and does not enqueue a worker job

## Current Additive Change Note: Tier Reasoning Controls and Curated Model Picker

- Add the additive migration `supabase/migrations/20260524_000014_subscription_tier_reasoning_controls.sql`.
- This migration adds:
  - `subscription_tiers.generation_reasoning_effort text not null default 'none'`
  - `subscription_tiers.generation_fallback_reasoning_effort text not null default 'none'`
  - constraints limiting tier models to Gemini 3 Flash, GPT 5.4 Mini, and Gemini 3.5 Flash
  - constraints allowing `xhigh` reasoning only on GPT 5.4 Mini
- Rollout order for this change:
  1. Apply the additive migration and seed updated Basic/Pro model and reasoning defaults.
  2. Deploy backend validation and session-bootstrap quota status support.
  3. Deploy worker support for tier-selected primary/fallback reasoning while retaining env fallback behavior for old queued jobs.
  4. Deploy frontend admin model/reasoning dropdowns and dashboard quota display.
- Post-deploy verification should confirm:
  - admins can save Basic/Pro request limits, primary/fallback models, and model-compatible reasoning levels
  - dashboard shows monthly requests remaining for Basic and Pro users
  - quota exhaustion returns a sanitized `quota_exhausted` response and does not enqueue a worker job
  - worker jobs use the tier-selected primary/fallback models and still fall back to env settings when hidden job model values are absent

## Current Additive Change Note: DeepSeek V4 Flash Subscription Model Option

- Add the additive migration `supabase/migrations/20260524_000015_add_deepseek_v4_flash_subscription_model.sql`.
- This migration updates `subscription_tiers` constraints so admins can choose `deepseek/deepseek-v4-flash` as either the primary or fallback generation model.
- DeepSeek V4 Flash reasoning is constrained to `none`, `high`, and `xhigh`, matching the provider's non-think, high, and max reasoning modes.
- Rollout order for this change:
  1. Apply the additive constraint migration.
  2. Deploy backend catalog validation with DeepSeek V4 Flash support.
  3. Deploy frontend admin model/reasoning dropdown support.
- Post-deploy verification should confirm admins can save DeepSeek V4 Flash with `none`, `high`, or `xhigh` reasoning and cannot save `low` or `medium` reasoning for that model.

## Historical Additive Change Note: Full Regeneration Cap and Deterministic Regeneration Hardening

- Add the additive migration `supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql`.
- This migration adds `applications.full_regeneration_count integer not null default 0` with a non-negative check constraint.
- The cap described here has been superseded for new behavior by monthly subscription quotas. Keep this note as historical context for the retained legacy column.
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

## Current Additive Change Note: Application Job Keywords

- Add the additive migration `supabase/migrations/20260615_000017_application_job_keywords.sql`.
- This migration adds nullable `applications.job_keywords jsonb` to store the latest ATS keyword extraction lifecycle state and ordered exact job-description phrases.
- The 2026-06-17 manual keyword and targeted keyword optimization update extends this JSON contract only. No additional migration is required because `applications.job_keywords` is already JSONB.
- Keyword entries may include `source: "extracted"` or `source: "manual"`, and manual entries may include `added_at`. Extraction reruns replace extracted entries and preserve manual entries.
- Rollout order for this change:
  1. Apply the additive migration.
  2. Deploy backend and worker code that queues keyword extraction after job-description capture or edits are persisted, persists queued/running/succeeded/failed payloads, bounds worker model attempts, and rejects stale callbacks by `user_id`, `job_id`, `source_hash`, and the current job-description hash.
  3. Deploy frontend keyword-panel UI and draft response handling that reads backend-computed coverage metrics.
- No backfill is required. Existing applications may keep `NULL` `job_keywords` until their job description is extracted, saved, recovered, or edited.
- Read paths must stay compatible with mixed rows where keyword extraction is unavailable, queued, running, failed, or succeeded against an older job-description hash.
- Stale `queued` or `running` keyword payloads are recovered to warn-only `failed` payloads during application detail and draft reads; this recovery must not change the primary application workflow status. There is no background sweep for keyword extraction state in the MVP, so rows are reconciled the next time the user or client reads the application or draft.
- Post-deploy verification should confirm:
  - URL extraction, pasted-description extraction, recovery extraction, manual entry, and later `job_description` edits enqueue standalone keyword extraction after the primary job description is persisted
  - stale keyword callbacks do not overwrite keywords for a newer job description, different keyword job id, or different user
  - hung keyword model calls time out, fall back when possible, and otherwise persist a warn-only failed keyword payload
  - keyword extraction failure leaves visible application status unchanged and does not block generation, editing, regeneration, judge, or export
  - draft responses compute case-insensitive exact phrase coverage without synonyms, fuzzy matching, stemming, punctuation variants, plural variants, or reordered words
  - backend callback persistence re-filters worker keywords against the current job description before storing them
  - generated and edited drafts refresh coverage metrics against the latest stored keyword list

### 2026-06-30 production recovery

- Railway production initially deployed the backend reader before migration `20260615_000017_application_job_keywords.sql`, causing application reads to fail on the missing `applications.job_keywords` column.
- The additive migration was applied to production and recorded in `app_meta.schema_migrations`; no row backfill was required.
- Future rollouts of schema-dependent readers must keep the documented migration-first order and verify the migration ledger before backend deployment.

## Historical Additive Change Note: Resume Judge Result Persistence

- Add the additive migration `supabase/migrations/20260417_000012_phase_5_resume_judge_result.sql`.
- This migration adds `applications.resume_judge_result jsonb` to store the latest Resume Judge lifecycle state and score for the current draft.
- Rollout order for this change:
  1. Apply the additive migration.
  2. Deploy backend and worker code that queues Resume Judge jobs, persists queued/running/succeeded/failed states, and ignores stale callbacks using semantic `input_signature` matching rather than draft-row `updated_at` alone.
  3. Deploy frontend score-tile and breakdown-dialog UI that reads `resume_judge_result` directly from the application payload, including the backend-computed `is_stale` flag.
- No backfill is required. Existing applications may keep `NULL` `resume_judge_result` until a new generation, regeneration, or manual judge run occurs.
- No new SQL migration is required for the semantic-freshness follow-up. The backend may add `input_signature` to newly written `resume_judge_result` payloads and opportunistically backfill current legacy results during export or later judge runs.
- Read paths must stay compatible with mixed rows where:
  - no judge result exists yet
  - a judge result exists for an older draft and must be treated as stale
  - a judge result predates the `run_attempt_count` JSON contract and must default safely without breaking rerun caps for newer writes
  - a judge result predates the `input_signature` JSON contract and must still remain current across export-only timestamp writes when the semantic inputs have not changed
  - the last judge attempt failed but the application remains exportable and editable
- Post-deploy verification should confirm:
  - initial generation, full regeneration, and section regeneration queue Resume Judge only after the new draft persists successfully
  - stale judge callbacks do not overwrite scores for newer edited drafts or job-detail changes
  - judge callbacks that return after PDF or DOCX export still persist when the semantic input signature matches
  - PDF and DOCX export do not stale a current judge score solely because `resume_drafts.updated_at` changed during export bookkeeping
  - `resume_judge_result` never changes `visible_status`, `failure_reason`, or export availability
  - manual `POST /api/applications/{id}/judge` enqueues a fresh run for an existing ready draft
  - manual `POST /api/applications/{id}/judge` stops accepting reruns after three queued attempts for the same semantic input signature
