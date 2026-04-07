# Backend and Database Migration Runbook

**Document status:** Baseline rollout guide  
**Last updated:** 2026-04-07 11:36:08 EDT
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
