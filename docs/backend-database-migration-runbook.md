# Backend and Database Migration Runbook

**Document status:** Baseline rollout guide  
**Last updated:** 2026-10-04
**Schema source of truth:** `docs/database_schema.md`  
**Product source of truth:** `docs/resume_builder_PRD_v3.md`

This runbook applies whenever backend or database work changes schema, compatibility, rollout order, backfills, retention, or post-deploy verification.

## 2026-10-04 generation speed and keep-original sections

- No SQL migration or backfill. Section document v1 gains optional `generation_notice` (`"kept_original_unverified"` or null) inside `resume_drafts.document` JSONB. Existing documents remain valid; older readers that ignore unknown keys are unaffected, but the agents and backend `ResumeSection` models both forbid extra keys, so **deploy backend and frontend before the worker**. The backend must accept the field before any worker sends it. The main deploy workflow enforces this: `deploy-agents` waits for backend and frontend in the same push, allowing unchanged services to be skipped. Each changed service must finish `scripts/wait-railway-deployment.py`, which verifies the expected main commit, successful deployment and active running instances within ten minutes. Three consecutive CLI/API errors, a superseded release, terminal deployment failure or timeout fail the job; a failed API/UI job blocks the worker upload. Build completion alone does not satisfy the gate.
- Models are now chosen by role in `shared/model-config.json` (bundled as `agents/model-config.json` and `backend/app/core/model-config.json`). `TIER1_MODEL`, `TIER1_FALLBACK_MODEL`, `TIER2_MODEL`, `TIER2_FALLBACK_MODEL`, `OPENROUTER_CLASSIFICATION_MODEL` and the interim `JEV_AUDIT_*` variables are no longer read. Remove them from Railway after deploy; leaving them set has no effect. To change a model, edit the shared file, copy it into both services (tests enforce this) and deploy both. Writing actions share ten model requests; Jev calls do not count. OpenRouter requests deny provider data collection, sort by latency and pin Gemini to Google AI Studio.
- Verify after deploy: a generation trace in LangSmith shows `applix.section_grounding_audit` with a Jev decisions child, `served_provider` on model runs, and two concurrent `section_generation` runs. A generation whose Summary cannot be verified completes, keeps the source Summary text and shows "Kept your original wording." Editing that section and saving clears the notice. Usage events record `kept_original_sections`.
- Progress records (Redis, not SQL) gain optional `partial_sections` (`[{id, kind, heading, content_md}]`, at most 20 sections of 12,000 characters). The backend drops malformed or oversized values instead of failing progress reads. The worker now also publishes each progress update on `phase1:applications:{id}:events`, so the live stream relays worker progress directly. Verify that a full generation shows Summary/Skills or Experience in the preview before completion, and that the preview clears on completion or failure.
- The worker runs up to 20 concurrent jobs (arq `max_jobs`, was the default 10), but at most 4 extraction browsers at once. Watch worker memory on Railway after deploy. Twenty concurrent generations can reserve roughly $7-8 of OpenRouter in-flight credit, so keep a comfortable balance.
- Rollback: redeploy the previous worker first, then backend/frontend. Stored notices stay harmless (a null-safe optional field); no schema rollback is needed.

## 2026-10-04 extraction recovery and claim-policy compatibility

- No SQL migration or backfill. New extraction diagnostics use the existing JSONB field: `timed_out`, `posting_unavailable` and `no_job_posting`. Older rows and their existing kinds remain readable. Deploy backend, worker and frontend together so persisted outcomes keep their specific recovery messages after navigation.
- Restart the worker to load its 120-second extraction boundary and arq abort support. Backend stop, stalled recovery and stalled deletion request cancellation. Stale recovery replaces progress only if the checked snapshot still matches; a fresh update or retry wins. Deleted stalled applications retain an ID-only terminal progress fence, with fixed status/timestamps and no source text, for at most 24 hours. Result caches are cleared. This retention fences queued work when abort delivery fails; it does not retain the deleted application row.
- Keep started delivery concurrent with capture/model work, but finish it before terminal progress or cache becomes visible. Cache the extracted payload before announcing success. Late started callbacks cannot move a terminal job back to extracting.
- Writing actions now share eight model requests and a 45-second audit timeout within their existing wall-clock deadline. High generation/regeneration permits the documented plausible job-fit additions; keyword optimization remains source-supported at every level. This changes acceptance policy, not quota or stored document shape.
- Verify a stopped running job frees its slot; a stopped queued job never opens a page; stalled recovery happens once and cannot replace fresh progress; stale deletion sends no failure notification and blocks late work even if abort fails; delayed started delivery cannot undo cached success; declined outcomes keep their explanation after reload. Verify a High keyword patch cannot use the permissive High audit.
- Rollback application code together and drain queued work before returning to older workers. Keep existing documents and JSON diagnostics; no schema rollback is needed. Older code may show generic recovery text for the new kinds and lacks the new extraction timeout/abort guarantees.

## 2026-10-03 resume library summary excerpts

- No SQL migration or backfill. The list query reads the first nonempty Summary section from the existing JSON document. Legacy rows without a document use the stored Markdown projection.
- The API adds a bounded plain-text `summary` field. Old clients ignore it; the new frontend accepts an absent field and displays its empty-summary state, so rollout and rollback remain compatible.
- Verify updated Summary text appears after a save, missing summaries remain empty, and another user's rows remain inaccessible. Do not expose the internal Markdown fields in the list response. The local Postgres integration test covers these conditions.

## 2026-10-03 dashboard creation-activity index

- Production verification on 2026-10-03 22:29 EDT confirmed merged main `bfa54bc` running on all three application services. Applied migration 023 and its ledger insertion in one transaction with a five-second lock timeout and sixty-second statement timeout; independently verified the index definition afterward. Historical subscription migrations 013–015 had existing schema effects but missing ledger entries. Verified their columns/defaults, validated constraints, foreign keys, indexes and update triggers before recording their completed schema state without replaying obsolete seed/model updates. Final ledger contains all 24 repository migrations; Basic/Pro limits remain 10/60 and all 11 protected tables retain forced RLS. See [release verification](task-output/2026-10-03-main-production-verification.md).
- Apply `20261003_000023_applications_user_created_at_index.sql` before or with the API that serves `GET /api/applications/creation-activity`. It is additive: one `(user_id, created_at DESC)` index on `applications`, no backfill, no data change. Lock acquisition is bounded at five seconds and SQL at sixty seconds; a failure rolls back cleanly and is safe to retry because the index uses `if not exists`.
- The plain index build blocks application writes while it runs. That is brief at current volume; a large table needs a planned window or a manual `create index concurrently` outside the transaction, followed by the ledger insert.
- The API still works without the index (same results, slower scans), so deploy order is flexible. Deploy the API before the frontend: an older API treats `creation-activity` as an application ID and returns an error, which leaves only the Activity panel in its retry state.
- The backend now depends on `tzdata` so IANA time-zone names resolve on slim images without system zone files. Postgres bucketing uses its own zone database; an unknown zone name fails with HTTP 422.
- Verify migration 023 in the ledger and the index definition. Check each range returns 7, 30, 90 daily or 52 weekly buckets; that counts match local-day boundaries for a non-UTC zone; that another user's applications never appear; and that unauthenticated requests return 401 and unknown ranges/zones return 422.
- Rollback: revert application code. The index can stay; drop it only through a separate reviewed migration.

## 2026-09-30 Railway release rollout

Production migrations 019–022 were applied via Railway CLI after an empty queue/active-job check and a private label backup. The duplicate-label count was zero. Each migration and ledger insertion committed atomically with bounded database timeouts. Verified the ledger, document/contact/source columns, unique name index and 10/60 plan allowances. Explicit operation models and Jev configuration were set without triggering early deployment. Deploy backend, agents and frontend from the merged main commit, then verify deployment identities and health.

## 2026-09-30 unique resume names

- Apply `20260930_000022_unique_resume_names.sql` before deploying the API conflict handling and updated workbench. The unique index enforces `(user_id, lower(btrim(name)))`; separate users can retain identical labels.
- Back up labels before rollout. The transaction locks writes, keeps the oldest duplicate by `created_at` and ID, and assigns available numbered suffixes to later duplicates. Existing suffixes are skipped. Renamed rows advance both revision counters, fencing stale edits. Resume content, stable IDs, ownership and application/default references stay intact.
- Lock acquisition is bounded at five seconds and SQL execution at sixty seconds. A failure rolls back the backfill and index. Retry through the normal migration runner after resolving contention; the index creation tolerates a retry after an interrupted ledger write. Large datasets may need a planned maintenance window.
- Verify migration 022 in the ledger and the unique index definition. Check duplicate creates, uploads and renames return HTTP 409 with the name-conflict message, preserve unsaved work, and never expose database details. Check a case-only rename of the same resume and reuse by another user still succeed. Check concurrent creates allow exactly one writer.
- Rollback application code together if needed. Retain the index and renamed labels to preserve uniqueness. Removing the index or restoring duplicate labels requires a separate reviewed data migration; code rollback alone does not restore prior labels.

## 2026-09-30 resume-owned inclusion and order

- No new SQL migration or backfill. Keep Profile `section_preferences`/`section_order`, legacy Markdown, excluded section content, and existing source snapshots. Do not copy Profile preferences into reviewed documents automatically.
- Deploy API, worker and frontend together. Drain earlier queued writing jobs before the switch: their queued section preferences may describe the old behavior. Existing Markdown worker envelopes remain compatible for drained jobs; new requests use reviewed section documents.
- New initial writing uses the base document's enabled flags and order. Default full, section and keyword regeneration use frozen source links and saved draft structure. A legacy draft with no document/source links must explicitly choose `use_latest_base=true` for full regeneration; failure leaves its previous content intact. Structured saves without links do not manufacture a source snapshot.
- `use_latest_base=true` is a deliberate reset to the linked reviewed base's content and layout. Successful regeneration stores a new snapshot; default regeneration can continue after the original base is deleted. Existing snapshots must never be silently rewritten on reads, Profile updates or base edits.
- Draft document edits atomically update `sections_snapshot` with enabled IDs in draft order under the existing revision/owner fence. Export projections omit excluded sections; comparison reads the frozen source and saved current document.
- Verify conflicting legacy Profile choices, repeated kinds/custom sections, exclusions/re-inclusion, reordered drafts, stale saves and owner isolation. Confirm regeneration keeps fixed/local sections and entry structure edits, blocks unreviewed re-inclusion before charging quota, and supports explicit legacy refresh. Confirm the latest PDF/DOCX ordering matches the draft and excluded content stays recoverable.
- Rollback requires draining new workers and reverting application code together. Older workers may restore base layout or apply Profile preferences; retain documents/snapshots and require review before writing again. No schema rollback is needed.

## 2026-09-30 section documents and import review

1. Apply `20260930_000019_resume_section_documents.sql`, then `20260930_000020_resume_contact_suggestions.sql` before deploying new readers or writers. Both are additive; RLS and same-user ownership remain in force.
2. Deploy API and workers together with pinned Pydantic AI 2.52.0. Existing Markdown jobs/drafts remain readable through explicit legacy adapters. Drain old queued generation work before enabling structured-source-only behavior, or allow the compatible old worker envelope during rollout.
3. No destructive backfill is required. Historical base documents are parsed locally with deterministic IDs, shown as needing review, and persisted on the next section save under a revision fence. Legacy drafts lack a trustworthy historical source snapshot; do not fabricate one from the current base for comparison.
4. New imports keep `raw_source_md`, local `contact_suggestions`, and sanitized warning guidance. These are owned user data subject to the same account deletion and access rules as the base resume. No persistent PDF storage is introduced.
5. Post-deploy verification: import a known and an unknown section; review, reorder and add a custom section; confirm stale base/draft saves return conflict; generate, edit the base, and confirm old draft comparison stays anchored to its snapshot; regenerate one role and confirm sibling content/IDs remain identical; verify separate-user reads cannot access any document or contact suggestion; export the latest projection.
6. Roll back application code before schema. Keep additive columns and stored snapshots through rollback; old code may update Markdown without maintaining documents, so reconciliation/review is required before re-enabling structured writes. Do not drop the new columns while any new worker or API is active.

Local validation uses Makefile test targets and local Docker Postgres/Redis. `test-migrate` applies migrations through the existing migration runner. Test invocations use fake provider keys, disable tracing, and clear test admin bootstrap configuration.

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
- When `APP_DEV_MODE=true`, the login surface selects an existing active local account from a dropdown without a password. `/api/auth/local-users` returns only active local account emails and is unavailable outside dev mode. The email-only login API remains available for local fixture setup. Protected routes restore an existing session only after a refresh-cookie-backed auth check succeeds.
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

## Current Security Change Note: Forced Row-Level Security

- Add migration `supabase/migrations/20260714_000018_enable_row_level_security.sql`.
- The migration creates the non-login `app_runtime` role, restricted `app_security` context functions, table grants, and explicit policies, then enables and forces RLS on all 11 application tables. It does not alter or backfill row data.
- The migration runner must be allowed to create/alter roles, grant `app_runtime` to its current database role, create the `app_security` schema, and alter table policies. Confirm those privileges before the production window.
- Rollout order:
  1. Back up the database and verify the migration runner privileges in staging.
  2. Use a controlled maintenance window unless the role/bootstrap and RLS activation are split across separate releases. Drain API traffic and stop old backend instances before policy activation; the old backend does not establish the required transaction-local context.
  3. Apply the migration while user traffic is stopped and verify it is recorded in `app_meta.schema_migrations`.
  4. Deploy the new backend, then deploy/restart workers that call it. Do not restore traffic if startup, `/healthz`, or the database policy checks fail.
  5. Run authenticated user, admin, invite, refresh-token, extension, extraction callback, generation callback, and export smoke tests against the new instances.
  6. Restore traffic only after those checks pass. A zero-downtime rollout requires a separate bootstrap release that creates `app_runtime` before the backend changes, followed by a later policy-activation release; do not apply this migration ahead of the backend during a normal rolling deployment.
- Post-deploy database verification:
  - all 11 tables report both `relrowsecurity` and `relforcerowsecurity`
  - `pg_policies` reports an explicit policy for every protected table and separate read/write policies for `user_invites` and `subscription_tiers`
  - an `app_runtime` transaction with user A's context cannot read or mutate user B's row
  - a transaction with no user or service context returns no protected rows
  - the explicit service context can perform the required cross-user operations exercised by admin, opaque-token lookup, and worker callback paths
- Emergency rollback uses the inverse compatibility order: drain traffic, keep the new backend live, disable RLS on the 11 tables, verify explicit repository scoping, then revert backend instances and restore traffic. Do not revert the backend while forced RLS remains active. Do not drop policies, functions, or the role; retain them for forward recovery and re-enable RLS as soon as the incident is resolved.
- This role-switching design protects against missing ownership predicates. A future credential-hardening migration should split user-scoped and service-scoped access across separately credentialed least-privilege login roles so compromise of the migration-owner database credential does not retain broad bypass capability.

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


## Current Change: Operation Routing and Request Allowances (021)

Migration `20260930_000021_subscription_request_allowances.sql` seeds Basic 10 / Pro 60 monthly writing requests. Existing usage counters and UTC reset periods are preserved. Historical model/effort columns and constraints remain compatibility metadata; current APIs and quota reservations no longer read them, and workers ignore legacy queued overrides.

Rollout: snapshot current plan limits for rollback; apply migration 021, configure the two shared model pairs, deploy backend and worker together, then deploy the quota-only admin UI. Old admin clients sending model fields receive validation errors and must refresh. No resume backfill or provider call occurs during migration. Existing drafts/source snapshots and flat resumes are unchanged.

Verification: confirm 10/60 allowances, preserved usage counts/RLS, quota-only API updates, identical routing for Basic/Pro, Tier 1 only for initial/full writing, Tier 2 repairs/audits/section operations, default reasoning, native structured-output compatibility, and refunds for failed/cancelled requests. Confirm generation callbacks/cache recovery do not enqueue quality scoring, while manual scoring still works. Run local Makefile tests before deployment. Local verification must use local Postgres/Auth only.

Rollback: restore saved plan limits and prior backend/worker/UI together. No destructive schema reversal is required; old model metadata remains available. Do not reset user usage counters or overwrite source documents. Production deployment is a separate action.


## Tier 2 resume entry import follow-up

No SQL migration or persisted document schema change is required. Source-line spans are transient provider output; persisted entries retain the existing fields, bullets and IDs contract. Uploads default to Tier 2 entry extraction. Explicit `use_llm_cleanup=false` clients retain local-only entry parsing; existing saved imports and frozen generation snapshots are not automatically rewritten.

Deploy backend and the upload-label frontend change together. Check a synthetic resume with repeated employers, plain company/location and title/date rows, wrapped bullets, and a single graduation year. Verify separate roles, exact duties, blank missing optional facts, preserved extracted text and the unreviewed gate. Provider failure must retain editable source with sanitized guidance. Use the Makefile local stack for these checks.

To repair a known local import, read its owner-scoped raw source, run the same validated import pipeline, preserve section IDs/headings/inclusion, and save through the owner-scoped service with the current expected revision. Stop if review or edits have changed the source. This task repaired only the reported local unreviewed import; there is no bulk backfill. Existing generated drafts keep their frozen source snapshots. Rollback restores prior backend/UI behavior without touching stored resumes.
