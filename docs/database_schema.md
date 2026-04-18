# AI Resume Builder Database Schema

**Document status:** Source of truth for the MVP database contract  
**Last updated:** 2026-04-17
**Primary product source:** `docs/resume_builder_PRD_v3.md`  
**Related rollout guide:** `docs/backend-database-migration-runbook.md`

## Scope and Principles

- Supabase Auth owns `auth.users`; application tables reference that identity and remain private to the authenticated user.
- Every user-scoped table must carry explicit ownership and be protected by Supabase RLS.
- All base resume content and generated draft content are stored as Markdown.
- `applied` remains a separate boolean and must never replace the primary visible status.
- MVP stores the current draft only. No resume version-history table is defined.
- MVP does not persist generated PDFs.
- Dedicated async job/progress tables are intentionally deferred until the worker model is chosen during implementation.

## Canonical Enums

| Enum | Values | Notes |
|---|---|---|
| `visible_status_enum` | `draft`, `needs_action`, `in_progress`, `complete` | User-visible application status |
| `internal_state_enum` | `extraction_pending`, `extracting`, `manual_entry_required`, `duplicate_review_required`, `generation_pending`, `generating`, `resume_ready`, `regenerating_section`, `regenerating_full`, `export_in_progress` | Internal workflow state |
| `failure_reason_enum` | `extraction_failed`, `generation_failed`, `generation_timeout`, `generation_cancelled`, `regeneration_failed`, `export_failed` | Nullable recoverable failure classification |
| `duplicate_resolution_status_enum` | `pending`, `dismissed`, `redirected` | Duplicate-review state |
| `job_posting_origin_enum` | `linkedin`, `indeed`, `google_jobs`, `glassdoor`, `ziprecruiter`, `monster`, `dice`, `company_website`, `other` | Normalized job posting source. UI labels should present these as LinkedIn, Indeed, Google Jobs, Glassdoor, ZipRecruiter, Monster, Dice, Company Website, and Other. |
| `notification_type_enum` | `info`, `success`, `warning`, `error` | In-app notification category |
| `invite_status_enum` | `pending`, `accepted`, `revoked`, `expired` | Invite lifecycle state |
| `usage_event_status_enum` | `success`, `failure`, `info` | Event-outcome classification for admin metrics |

The backend owns transition rules between statuses and processing states. The database stores the current values but does not attempt to encode the full transition graph.

## Canonical JSONB Contracts

Backend write paths must validate these shapes before persisting them.

| Column | JSON shape | Notes |
|---|---|---|
| `profiles.section_preferences` | Object map of section identifier to boolean, for example `{"summary": true, "professional_experience": true, "education": true, "skills": true}` | Default keys are the four MVP sections. Additional keys may exist for forward compatibility but are ignored unless the application supports them. |
| `profiles.section_order` | Ordered JSON array of section identifiers, for example `["summary", "professional_experience", "education", "skills"]` | Must contain enabled sections in the order used for future generations. |
| `applications.extraction_failure_details` | Object with `kind`, `provider`, `reference_id`, `blocked_url`, and `detected_at`, for example `{"kind": "blocked_source", "provider": "indeed", "reference_id": "9e8afb060bd31117", "blocked_url": "https://www.indeed.com/viewjob?jk=abc123", "detected_at": "2026-04-07T19:30:43+00:00"}` | Stores sanitized extraction failure diagnostics for recoverable failures. MVP currently persists blocked-source metadata only. |
| `applications.generation_failure_details` | Object with `message` and optional `validation_errors` array, for example `{"message": "Validation failed", "validation_errors": ["Hallucinated employer detected", "Missing required section: skills"]}` | Stores generation, timeout, cancellation, validation, and regeneration failure details in a user-safe shape. |
| `applications.resume_judge_result` | Object with `status`, optional `message`, optional score fields, `dimension_scores`, `regeneration_instructions`, `regeneration_priority_dimensions`, `evaluator_notes`, `evaluated_draft_updated_at`, `scored_at`, optional `run_attempt_count`, and optional sanitized failure diagnostics, for example `{"status": "succeeded", "final_score": 77.6, "display_score": 78, "verdict": "warn", "pass_threshold": 80, "score_summary": "Strong alignment with a few voice issues.", "dimension_scores": {"role_alignment": {"score": 8, "weight": 0.25, "weighted_contribution": 20.0, "notes": "Aligned to the JD."}}, "regeneration_instructions": "Tighten the summary voice.", "regeneration_priority_dimensions": ["voice_and_human_quality"], "evaluator_notes": "A targeted rewrite should push this above the pass threshold.", "evaluated_draft_updated_at": "2026-04-17T14:10:00+00:00", "scored_at": "2026-04-17T14:12:00+00:00", "run_attempt_count": 1}` | Stores the latest Resume Judge state for the current draft, including queued/running/succeeded/failed states, per-draft rerun counts, and stale-draft comparison metadata. |
| `applications.extracted_reference_id` | Lowercase or normalized requisition/reference identifier, for example `"req-42"` | Stores the reference identifier extracted during capture so duplicate detection can use a persisted signal instead of re-parsing URLs or descriptions later. |
| `applications.duplicate_match_fields` | Object with `matched_fields` array and `match_basis` string, for example `{"matched_fields": ["job_title", "company", "job_url"], "match_basis": "exact_job_url"}` | Stores what caused the duplicate warning, not the full comparison payload. `matched_fields` may include `job_posting_origin`, `job_url`, `reference_id`, or `job_description` only when those signals actually contributed to the duplicate warning. |
| `resume_drafts.generation_params` | Object with `page_length`, `aggressiveness`, and `additional_instructions`, for example `{"page_length": "1_page", "aggressiveness": "medium", "additional_instructions": null}` | `page_length` values: `1_page`, `2_page`, `3_page`. `aggressiveness` values: `low`, `medium`, `high`. |
| `resume_drafts.sections_snapshot` | Object with `enabled_sections` and `section_order`, for example `{"enabled_sections": ["summary", "professional_experience", "education", "skills"], "section_order": ["summary", "professional_experience", "education", "skills"]}` | Snapshot taken at generation time so later preference changes do not rewrite old drafts implicitly. |

## Table Definitions

### `profiles`

Application-owned extension of `auth.users`.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. Foreign key to `auth.users.id` with `ON DELETE CASCADE`. One profile per auth user. |
| `email` | `text` | No | — | Read-only mirror of auth email for application queries. User-editing is not allowed. |
| `first_name` | `text` | Yes | `null` | Nullable until invite onboarding is completed. |
| `last_name` | `text` | Yes | `null` | Nullable until invite onboarding is completed. |
| `name` | `text` | Yes | `null` | Required by the product before final assembly/export, but nullable at rest until the user completes the profile. |
| `phone` | `text` | Yes | `null` | Nullable until user provides it. |
| `address` | `text` | Yes | `null` | Nullable until user provides it. Used as the short location line in resume assembly and export. |
| `linkedin_url` | `text` | Yes | `null` | Optional LinkedIn profile URL used in resume assembly and export. |
| `is_admin` | `boolean` | No | `false` | Grants access to admin routes and screens. |
| `is_active` | `boolean` | No | `true` | Deactivated users are blocked from application access. |
| `onboarding_completed_at` | `timestamptz` | Yes | `null` | Set when invite signup is accepted successfully. |
| `default_base_resume_id` | `uuid` | Yes | `null` | Canonical pointer to the user's default base resume. Composite foreign key with `id` to `base_resumes (id, user_id)` and `ON DELETE SET NULL`. |
| `section_preferences` | `jsonb` | No | `{"summary": true, "professional_experience": true, "education": true, "skills": true}` | See JSON contract above. |
| `section_order` | `jsonb` | No | `["summary", "professional_experience", "education", "skills"]` | See JSON contract above. |
| `extension_token_hash` | `text` | Yes | `null` | Server-side hash of the scoped Chrome extension import token. Never exposed back to the client. |
| `extension_token_created_at` | `timestamptz` | Yes | `null` | When the current extension token was issued or rotated. |
| `extension_token_last_used_at` | `timestamptz` | Yes | `null` | Last successful extension import using the scoped token. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Notes**

- `profiles.default_base_resume_id` is the canonical default-resume selector.
- The PRD logical field `base_resumes.is_default` is intentionally normalized into this profile pointer to avoid dual sources of truth.

**Constraints**

- `UNIQUE (email)`
- Unique partial index on `extension_token_hash` when present

**RLS requirements**

- `SELECT`, `INSERT`, and `UPDATE` allowed only when `auth.uid() = id`.
- No anonymous access.
- Service-role access is reserved for trusted provisioning and backend jobs.

### `base_resumes`

Stored Markdown source resumes owned by a single user.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `name` | `text` | No | — | User-defined label. Must be non-blank. |
| `content_md` | `text` | No | — | Full resume stored as Markdown. Must be non-blank. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (id, user_id)` to support same-user composite foreign keys.
- `CHECK (btrim(name) <> '')`
- `CHECK (btrim(content_md) <> '')`

**RLS requirements**

- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` allowed only when `auth.uid() = user_id`.
- Service-role access is reserved for trusted backend work that still scopes writes by `user_id`.

**Delete behavior**

- Deleting a base resume clears `profiles.default_base_resume_id`.
- Deleting a base resume clears `applications.base_resume_id`.
- Existing applications remain valid after the reference is cleared.

### `applications`

User-owned job application records and workflow state.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `job_url` | `text` | No | — | Source URL used for extraction. Must be non-blank. |
| `job_title` | `text` | Yes | `null` | Nullable until extraction or manual entry succeeds. |
| `company` | `text` | Yes | `null` | Nullable until extraction or manual entry succeeds. |
| `job_description` | `text` | Yes | `null` | Nullable until extraction or manual entry succeeds. Stores the full primary job posting body when available, not just a responsibilities excerpt. |
| `job_location_text` | `text` | Yes | `null` | Nullable raw location or hiring-region text copied from the posting or manual entry when available. |
| `compensation_text` | `text` | Yes | `null` | Nullable raw salary or compensation text copied from the posting or manual entry when available. |
| `extracted_reference_id` | `text` | Yes | `null` | Persisted reference or requisition identifier extracted from the posting when available. |
| `job_posting_origin` | `job_posting_origin_enum` | Yes | `null` | Normalized posting source when extraction or user input can identify it. |
| `job_posting_origin_other_text` | `text` | Yes | `null` | Free-text source label used only when `job_posting_origin = 'other'`. |
| `base_resume_id` | `uuid` | Yes | `null` | Composite foreign key with `user_id` to `base_resumes (id, user_id)` and `ON DELETE SET NULL`. |
| `visible_status` | `visible_status_enum` | No | `draft` | User-visible status. |
| `internal_state` | `internal_state_enum` | No | `extraction_pending` | Internal workflow state. |
| `failure_reason` | `failure_reason_enum` | Yes | `null` | Nullable recoverable failure type. |
| `extraction_failure_details` | `jsonb` | Yes | `null` | See JSON contract above. |
| `generation_failure_details` | `jsonb` | Yes | `null` | See JSON contract above. |
| `resume_judge_result` | `jsonb` | Yes | `null` | See JSON contract above. Stores the latest Resume Judge score or failure state for the current draft only. |
| `applied` | `boolean` | No | `false` | User-controlled flag independent from `visible_status`. |
| `duplicate_similarity_score` | `numeric(5,2)` | Yes | `null` | Percentage score from `0.00` to `100.00`. |
| `duplicate_match_fields` | `jsonb` | Yes | `null` | See JSON contract above. |
| `duplicate_resolution_status` | `duplicate_resolution_status_enum` | Yes | `null` | `pending`, `dismissed`, or `redirected` when a duplicate is detected. |
| `duplicate_matched_application_id` | `uuid` | Yes | `null` | Self-reference to the application surfaced in duplicate review. Composite foreign key with `user_id` to `applications (id, user_id)` and `ON DELETE SET NULL`. |
| `notes` | `text` | Yes | `null` | Free-text notes from the application detail page. |
| `full_regeneration_count` | `integer` | No | `0` | Per-application count of successfully queued full regenerations for non-admin cap enforcement. |
| `exported_at` | `timestamptz` | Yes | `null` | Last successful export timestamp for the application, regardless of supported export format. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (id, user_id)` to support same-user composite foreign keys.
- `CHECK (btrim(job_url) <> '')`
- `CHECK (duplicate_similarity_score IS NULL OR (duplicate_similarity_score >= 0 AND duplicate_similarity_score <= 100))`
- `CHECK (full_regeneration_count >= 0)`
- `CHECK (job_posting_origin_other_text IS NULL OR btrim(job_posting_origin_other_text) <> '')`
- Database or backend validation must enforce: `job_posting_origin_other_text` is required when `job_posting_origin = 'other'` and must be `NULL` for all other origin values.

**Behavior notes**

- `applied` must remain editable regardless of the primary visible status.
- `job_posting_origin` may remain `NULL` after extraction succeeds if origin classification is unknown; the user may supply or edit it later.
- `job_location_text` is optional raw posting text and must not block extraction success, duplicate review, or generation readiness when absent.
- `compensation_text` is optional raw posting text and must not block extraction success, duplicate review, or generation readiness when absent.
- Extraction should separate `job_location_text` and `compensation_text` semantically from posting context, even when both appear on the same rendered line, and should leave either field null when the distinction is not clear.
- `extraction_failure_details` stores sanitized recoverable diagnostics for extraction failures. MVP uses it for blocked-source metadata such as provider, reference ID, blocked URL, and detection timestamp.
- `generation_failure_details` stores generation and regeneration failure diagnostics including timeout or cancellation copy plus an optional array of specific validation errors. Cleared on successful generation or regeneration.
- `resume_judge_result` stores the latest Resume Judge lifecycle state for the current draft. It may be `queued`, `running`, `succeeded`, or `failed`, and it must not drive `visible_status` or `failure_reason`.
- `extracted_reference_id` should be written from the extraction pipeline when present and reused by duplicate detection before falling back to URL or description parsing.
- Duplicate dismissal is stored on the application so the warning does not re-evaluate for that application after dismissal.
- Duplicate detection must include normalized `job_posting_origin` when it is populated on both compared applications, and fall back to `job_title` + `company` matching when origin is missing on either side.
- `full_regeneration_count` is incremented when a full regeneration job is successfully queued for non-admin users, and is used to enforce a hard per-application cap of three full regenerations for non-admin accounts.
- `resume_judge_result.evaluated_draft_updated_at` is the stale-result fence. Frontend and backend should compare it against `resume_drafts.updated_at` before treating the stored score as current.
- `resume_judge_result.run_attempt_count` counts queued Resume Judge runs for the current draft and job context only. It resets when the draft changes or the stored job-context signature becomes stale, and it must stop manual reruns after the third queued attempt.
- The backend must clear stale `failure_reason` values when a recoverable workflow succeeds.

**RLS requirements**

- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` allowed only when `auth.uid() = user_id`.
- Service-role access is reserved for trusted backend jobs that still scope every query by `user_id`.

### `resume_drafts`

Single current Markdown draft for one application.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `application_id` | `uuid` | No | — | Foreign key to the owning application. Composite foreign key with `user_id` to `applications (id, user_id)` and `ON DELETE CASCADE`. |
| `user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `content_md` | `text` | No | — | Latest assembled resume content in Markdown. Must be non-blank. |
| `generation_params` | `jsonb` | No | — | See JSON contract above. |
| `sections_snapshot` | `jsonb` | No | — | See JSON contract above. |
| `last_generated_at` | `timestamptz` | No | — | Updated on successful generation and full regeneration. |
| `last_exported_at` | `timestamptz` | Yes | `null` | Updated on successful export, regardless of supported export format. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write, including manual edits. |

**Constraints**

- `UNIQUE (application_id)` enforces one current draft per application.
- `CHECK (btrim(content_md) <> '')`

**Behavior notes**

- MVP overwrites the current draft on full regeneration.
- Editing or regeneration after export returns the application to `needs_action` (resume ready but export stale), but historical export timestamps may remain populated.
- `applications.exported_at` and `resume_drafts.last_exported_at` must be updated together on successful export while MVP keeps a single current draft.

**RLS requirements**

- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` allowed only when `auth.uid() = user_id`.
- Service-role access is reserved for trusted backend jobs that still scope every query by `user_id`.

### `notifications`

In-app workflow notifications for a single user.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `application_id` | `uuid` | Yes | `null` | Composite foreign key with `user_id` to `applications (id, user_id)` and `ON DELETE SET NULL`. |
| `type` | `notification_type_enum` | No | — | `info`, `success`, `warning`, or `error`. |
| `message` | `text` | No | — | User-visible notification copy. Must be non-blank. |
| `action_required` | `boolean` | No | `false` | Drives dashboard and detail attention indicators. |
| `read` | `boolean` | No | `false` | Read/unread state. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |

**Constraints**

- `CHECK (btrim(message) <> '')`

**Behavior notes**

- High-signal failures and unresolved duplicate review must create `action_required = true` notifications.
- `action_required` is an active-attention flag, not permanent history. Recovery flows should clear it when the underlying issue is resolved.
- Notifications may outlive deleted application references by keeping the row and nulling `application_id`.

**RLS requirements**

- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` allowed only when `auth.uid() = user_id`.
- Service-role access is reserved for trusted backend jobs that still scope every query by `user_id`.

### `user_invites`

Invite lifecycle records for invite-only onboarding.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key. |
| `invitee_user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `invited_by_user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `invited_email` | `text` | No | — | Normalized invited address. |
| `token_hash` | `text` | No | — | Secure hash of invite token; plaintext token must never be stored. |
| `status` | `invite_status_enum` | No | `pending` | Invite lifecycle status. |
| `expires_at` | `timestamptz` | No | — | Invite expiry timestamp. |
| `sent_at` | `timestamptz` | No | `now()` | Invite send timestamp. |
| `accepted_at` | `timestamptz` | Yes | `null` | Set when invite is accepted. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (token_hash)`
- Partial unique index for one pending invite per invitee user
- `CHECK (btrim(invited_email) <> '')`
- `CHECK (btrim(token_hash) <> '')`

**RLS requirements**

- Owner visibility for both inviter and invitee (`auth.uid() = invited_by_user_id OR auth.uid() = invitee_user_id`).
- Inserts allowed only for inviter ownership.
- Updates allowed only for inviter/invitee ownership.

### `usage_events`

Sanitized user-scoped event stream for admin metrics and workflow telemetry.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `auth.users.id` with `ON DELETE CASCADE`. |
| `application_id` | `uuid` | Yes | `null` | Foreign key to `applications.id` with `ON DELETE SET NULL`. |
| `event_type` | `text` | No | — | Operation/event key (for example extraction, generation, regeneration, export). |
| `event_status` | `usage_event_status_enum` | No | — | `success`, `failure`, or `info`. |
| `metadata` | `jsonb` | No | `'{}'::jsonb` | Sanitized metadata only. |
| `created_at` | `timestamptz` | No | `now()` | Event timestamp. |

**Constraints**

- `CHECK (btrim(event_type) <> '')`

**RLS requirements**

- `SELECT` and `INSERT` allowed only when `auth.uid() = user_id`.
- No cross-user reads or writes.

## Relationship and Delete Semantics

| Relationship | Rule |
|---|---|
| `profiles.id -> auth.users.id` | `ON DELETE CASCADE` |
| `base_resumes.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `applications.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `resume_drafts.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `notifications.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `user_invites.invitee_user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `user_invites.invited_by_user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `usage_events.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `profiles (default_base_resume_id, id) -> base_resumes (id, user_id)` | `ON DELETE SET NULL` |
| `applications (base_resume_id, user_id) -> base_resumes (id, user_id)` | `ON DELETE SET NULL` |
| `applications (duplicate_matched_application_id, user_id) -> applications (id, user_id)` | `ON DELETE SET NULL` |
| `resume_drafts (application_id, user_id) -> applications (id, user_id)` | `ON DELETE CASCADE` |
| `notifications (application_id, user_id) -> applications (id, user_id)` | `ON DELETE SET NULL` |
| `usage_events.application_id -> applications.id` | `ON DELETE SET NULL` |

If implementation constraints require equivalent ownership validation outside a composite foreign key, the same-user invariant must still be enforced through a combination of RLS and backend validation.

## Index Strategy

| Index target | Purpose |
|---|---|
| `profiles.email` unique index | Fast profile lookup by mirrored auth email if needed |
| `profiles.extension_token_hash` unique partial index | Fast scoped extension-token lookup |
| `base_resumes (user_id, updated_at DESC)` | Resume list ordering |
| `base_resumes (user_id, name)` | Name-based selection and lookup |
| `applications (user_id, updated_at DESC)` | Dashboard default sort |
| `applications (user_id, visible_status, updated_at DESC)` | Status filtering on dashboard |
| Search index over `applications.job_title` and `applications.company` within user scope | Dashboard search by job title or company |
| `applications (user_id, duplicate_resolution_status)` with a partial index for unresolved duplicates | Fast duplicate-attention queries |
| `resume_drafts (application_id)` unique index | Current draft lookup for an application |
| `notifications (user_id, read, created_at DESC)` | Notification inbox queries |
| `notifications (user_id, action_required, read, created_at DESC)` with a partial index for unread action-required notifications | Dashboard/detail attention indicators |
| `user_invites (invitee_user_id)` partial unique index on pending rows | Prevent multiple active pending invites per user |
| `user_invites (status, created_at DESC)` | Admin invite lifecycle filtering and counts |
| `user_invites (invited_by_user_id, created_at DESC)` | Admin inviter activity and audit retrieval |
| `usage_events (event_type, created_at DESC)` | Metrics aggregation for workflow events |
| `usage_events (user_id, created_at DESC)` | User-scoped metrics and event drill-down |
| `usage_events (application_id, created_at DESC)` | Application event history lookups |

The exact Postgres index type may vary by implementation. For dashboard search, use an index strategy compatible with the final search behavior, such as trigram or full-text search.

## RLS Policy Requirements

| Table | Minimum policy requirement |
|---|---|
| `profiles` | User can read and update only the row where `id = auth.uid()` |
| `base_resumes` | User can operate only on rows where `user_id = auth.uid()` |
| `applications` | User can operate only on rows where `user_id = auth.uid()` |
| `resume_drafts` | User can operate only on rows where `user_id = auth.uid()` |
| `notifications` | User can operate only on rows where `user_id = auth.uid()` |
| `user_invites` | Inviter and invitee can read invite rows; inserts limited to inviter ownership; updates limited to inviter/invitee ownership |
| `usage_events` | User can read and insert only rows where `user_id = auth.uid()` |

Additional rules:

- No table in this document may expose anonymous read or write access.
- Backend code must keep explicit `user_id` scoping even when service-role credentials bypass RLS.
- Background jobs, notifications, and exports must resolve and persist data within the authenticated user's ownership boundary only.

## Implementation Notes

- Use `timestamptz` for all timestamps.
- Maintain `updated_at` automatically on write through a shared trigger or equivalent backend discipline.
- Keep enum names and values aligned with the PRD status model; do not introduce alternate status labels.
- Preserve `job_title`, `company`, `job_description`, `job_location_text`, `compensation_text`, and `job_posting_origin` as nullable until extraction or manual entry succeeds, while allowing `job_posting_origin` to remain `NULL` when the source cannot be classified yet.
- Do not add persistent PDF storage columns or tables for MVP.
