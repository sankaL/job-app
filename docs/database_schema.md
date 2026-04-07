# AI Resume Builder Database Schema

**Document status:** Source of truth for the MVP database contract  
**Last updated:** 2026-04-06 21:08:42 EDT  
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
| `failure_reason_enum` | `extraction_failed`, `generation_failed`, `regeneration_failed`, `export_failed` | Nullable failure classification |
| `duplicate_resolution_status_enum` | `pending`, `dismissed`, `redirected` | Duplicate-review state |
| `notification_type_enum` | `info`, `success`, `warning`, `error` | In-app notification category |

The backend owns transition rules between statuses and processing states. The database stores the current values but does not attempt to encode the full transition graph.

## Canonical JSONB Contracts

Backend write paths must validate these shapes before persisting them.

| Column | JSON shape | Notes |
|---|---|---|
| `profiles.section_preferences` | Object map of section identifier to boolean, for example `{"summary": true, "professional_experience": true, "education": true, "skills": true}` | Default keys are the four MVP sections. Additional keys may exist for forward compatibility but are ignored unless the application supports them. |
| `profiles.section_order` | Ordered JSON array of section identifiers, for example `["summary", "professional_experience", "education", "skills"]` | Must contain enabled sections in the order used for future generations. |
| `applications.duplicate_match_fields` | Object with `matched_fields` array and `match_basis` string, for example `{"matched_fields": ["job_title", "company"], "match_basis": "combined_job_title_company"}` | Stores what caused the duplicate warning, not the full comparison payload. |
| `resume_drafts.generation_params` | Object with `page_length`, `aggressiveness`, and `additional_instructions`, for example `{"page_length": "1_page", "aggressiveness": "medium", "additional_instructions": null}` | `page_length` values: `1_page`, `2_page`, `3_page`. `aggressiveness` values: `low`, `medium`, `high`. |
| `resume_drafts.sections_snapshot` | Object with `enabled_sections` and `section_order`, for example `{"enabled_sections": ["summary", "professional_experience", "education", "skills"], "section_order": ["summary", "professional_experience", "education", "skills"]}` | Snapshot taken at generation time so later preference changes do not rewrite old drafts implicitly. |

## Table Definitions

### `profiles`

Application-owned extension of `auth.users`.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. Foreign key to `auth.users.id` with `ON DELETE CASCADE`. One profile per auth user. |
| `email` | `text` | No | — | Read-only mirror of auth email for application queries. User-editing is not allowed. |
| `name` | `text` | Yes | `null` | Required by the product before final assembly/export, but nullable at rest until the user completes the profile. |
| `phone` | `text` | Yes | `null` | Nullable until user provides it. |
| `address` | `text` | Yes | `null` | Nullable until user provides it. |
| `default_base_resume_id` | `uuid` | Yes | `null` | Canonical pointer to the user's default base resume. Composite foreign key with `id` to `base_resumes (id, user_id)` and `ON DELETE SET NULL`. |
| `section_preferences` | `jsonb` | No | `{"summary": true, "professional_experience": true, "education": true, "skills": true}` | See JSON contract above. |
| `section_order` | `jsonb` | No | `["summary", "professional_experience", "education", "skills"]` | See JSON contract above. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Notes**

- `profiles.default_base_resume_id` is the canonical default-resume selector.
- The PRD logical field `base_resumes.is_default` is intentionally normalized into this profile pointer to avoid dual sources of truth.

**Constraints**

- `UNIQUE (email)`

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
| `job_description` | `text` | Yes | `null` | Nullable until extraction or manual entry succeeds. |
| `base_resume_id` | `uuid` | Yes | `null` | Composite foreign key with `user_id` to `base_resumes (id, user_id)` and `ON DELETE SET NULL`. |
| `visible_status` | `visible_status_enum` | No | `draft` | User-visible status. |
| `internal_state` | `internal_state_enum` | No | `extraction_pending` | Internal workflow state. |
| `failure_reason` | `failure_reason_enum` | Yes | `null` | Nullable recoverable failure type. |
| `applied` | `boolean` | No | `false` | User-controlled flag independent from `visible_status`. |
| `duplicate_similarity_score` | `numeric(5,2)` | Yes | `null` | Percentage score from `0.00` to `100.00`. |
| `duplicate_match_fields` | `jsonb` | Yes | `null` | See JSON contract above. |
| `duplicate_resolution_status` | `duplicate_resolution_status_enum` | Yes | `null` | `pending`, `dismissed`, or `redirected` when a duplicate is detected. |
| `duplicate_matched_application_id` | `uuid` | Yes | `null` | Self-reference to the application surfaced in duplicate review. Composite foreign key with `user_id` to `applications (id, user_id)` and `ON DELETE SET NULL`. |
| `notes` | `text` | Yes | `null` | Free-text notes from the application detail page. |
| `exported_at` | `timestamptz` | Yes | `null` | Last successful export timestamp for the application. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (id, user_id)` to support same-user composite foreign keys.
- `CHECK (btrim(job_url) <> '')`
- `CHECK (duplicate_similarity_score IS NULL OR (duplicate_similarity_score >= 0 AND duplicate_similarity_score <= 100))`

**Behavior notes**

- `applied` must remain editable regardless of the primary visible status.
- Duplicate dismissal is stored on the application so the warning does not re-evaluate for that application after dismissal.
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
| `last_exported_at` | `timestamptz` | Yes | `null` | Updated on successful export. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write, including manual edits. |

**Constraints**

- `UNIQUE (application_id)` enforces one current draft per application.
- `CHECK (btrim(content_md) <> '')`

**Behavior notes**

- MVP overwrites the current draft on full regeneration.
- Editing or regeneration after export returns the application to `in_progress`, but historical export timestamps may remain populated.
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

- High-signal failures must create `action_required = true` notifications.
- Notifications may outlive deleted application references by keeping the row and nulling `application_id`.

**RLS requirements**

- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` allowed only when `auth.uid() = user_id`.
- Service-role access is reserved for trusted backend jobs that still scope every query by `user_id`.

## Relationship and Delete Semantics

| Relationship | Rule |
|---|---|
| `profiles.id -> auth.users.id` | `ON DELETE CASCADE` |
| `base_resumes.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `applications.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `resume_drafts.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `notifications.user_id -> auth.users.id` | `ON DELETE CASCADE` |
| `profiles (default_base_resume_id, id) -> base_resumes (id, user_id)` | `ON DELETE SET NULL` |
| `applications (base_resume_id, user_id) -> base_resumes (id, user_id)` | `ON DELETE SET NULL` |
| `applications (duplicate_matched_application_id, user_id) -> applications (id, user_id)` | `ON DELETE SET NULL` |
| `resume_drafts (application_id, user_id) -> applications (id, user_id)` | `ON DELETE CASCADE` |
| `notifications (application_id, user_id) -> applications (id, user_id)` | `ON DELETE SET NULL` |

If implementation constraints require equivalent ownership validation outside a composite foreign key, the same-user invariant must still be enforced through a combination of RLS and backend validation.

## Index Strategy

| Index target | Purpose |
|---|---|
| `profiles.email` unique index | Fast profile lookup by mirrored auth email if needed |
| `base_resumes (user_id, updated_at DESC)` | Resume list ordering |
| `base_resumes (user_id, name)` | Name-based selection and lookup |
| `applications (user_id, updated_at DESC)` | Dashboard default sort |
| `applications (user_id, visible_status, updated_at DESC)` | Status filtering on dashboard |
| Search index over `applications.job_title` and `applications.company` within user scope | Dashboard search by job title or company |
| `applications (user_id, duplicate_resolution_status)` with a partial index for unresolved duplicates | Fast duplicate-attention queries |
| `resume_drafts (application_id)` unique index | Current draft lookup for an application |
| `notifications (user_id, read, created_at DESC)` | Notification inbox queries |
| `notifications (user_id, action_required, read, created_at DESC)` with a partial index for unread action-required notifications | Dashboard/detail attention indicators |

The exact Postgres index type may vary by implementation. For dashboard search, use an index strategy compatible with the final search behavior, such as trigram or full-text search.

## RLS Policy Requirements

| Table | Minimum policy requirement |
|---|---|
| `profiles` | User can read and update only the row where `id = auth.uid()` |
| `base_resumes` | User can operate only on rows where `user_id = auth.uid()` |
| `applications` | User can operate only on rows where `user_id = auth.uid()` |
| `resume_drafts` | User can operate only on rows where `user_id = auth.uid()` |
| `notifications` | User can operate only on rows where `user_id = auth.uid()` |

Additional rules:

- No table in this document may expose anonymous read or write access.
- Backend code must keep explicit `user_id` scoping even when service-role credentials bypass RLS.
- Background jobs, notifications, and exports must resolve and persist data within the authenticated user's ownership boundary only.

## Implementation Notes

- Use `timestamptz` for all timestamps.
- Maintain `updated_at` automatically on write through a shared trigger or equivalent backend discipline.
- Keep enum names and values aligned with the PRD status model; do not introduce alternate status labels.
- Preserve `job_title`, `company`, and `job_description` as nullable until extraction or manual entry succeeds.
- Do not add persistent PDF storage columns or tables for MVP.
