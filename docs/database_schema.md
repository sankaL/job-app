# AI Resume Builder Database Schema

**Document status:** Source of truth for the MVP database contract  
**Last updated:** 2026-05-25
**Primary product source:** `docs/resume_builder_PRD_v3.md`  
**Related rollout guide:** `docs/backend-database-migration-runbook.md`

## Scope and Principles

- The app owns `public.users` and manages auth independently via FastAPI (custom JWT + bcrypt).
- Application tables reference `public.users.id` and remain private to the authenticated user.
- Backend code enforces per-user isolation on every query via explicit `user_id` scoping.
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
| `profiles.section_preferences` | Object map of section identifier to boolean, for example `{"summary": true, "professional_experience": true, "education": true, "skills": true, "projects": true, "certifications": true}` | Supported keys are `summary`, `professional_experience`, `education`, `skills`, `projects`, and `certifications`. Generation uses the intersection of enabled sections and sections supported by the sanitized base resume. |
| `profiles.section_order` | Ordered JSON array of section identifiers, for example `["summary", "professional_experience", "education", "skills", "projects", "certifications"]` | Must contain enabled sections in the order used for future generations. |
| `applications.extraction_failure_details` | Object with `kind`, `provider`, `reference_id`, `blocked_url`, and `detected_at`, for example `{"kind": "blocked_source", "provider": "indeed", "reference_id": "9e8afb060bd31117", "blocked_url": "https://www.indeed.com/viewjob?jk=abc123", "detected_at": "2026-04-07T19:30:43+00:00"}` | Stores sanitized extraction failure diagnostics for recoverable failures. MVP currently persists blocked-source metadata only. |
| `applications.generation_failure_details` | Object with `message` and optional `validation_errors` array, for example `{"message": "Validation failed", "validation_errors": ["Hallucinated employer detected", "Missing required section: skills"]}` | Stores generation, timeout, cancellation, validation, and regeneration failure details in a user-safe shape. |
| `applications.resume_judge_result` | Object with `status`, optional `message`, optional score fields, `dimension_scores`, section-keyed `regeneration_instructions`, `regeneration_priority_dimensions`, `evaluator_notes`, `evaluated_draft_updated_at`, `scored_at`, optional `input_signature`, optional `run_attempt_count`, optional `attempt_count`, optional sanitized `attempts`, and optional sanitized failure diagnostics, for example `{"status": "succeeded", "final_score": 77.6, "display_score": 78, "verdict": "warn", "pass_threshold": 80, "score_summary": "Strong alignment with a few voice issues.", "dimension_scores": {"role_alignment": {"score": 8, "weight": 0.25, "weighted_contribution": 20.0, "notes": "Aligned to the JD."}}, "regeneration_instructions": {"summary": ["Tighten the summary voice."]}, "regeneration_priority_dimensions": ["voice_and_human_quality"], "evaluator_notes": "A targeted rewrite should push this above the pass threshold.", "evaluated_draft_updated_at": "2026-04-17T14:10:00+00:00", "scored_at": "2026-04-17T14:12:00+00:00", "input_signature": "8f5f5b3c...", "run_attempt_count": 1, "attempt_count": 1}` | Stores the latest Resume Judge state for the current draft, including queued/running/succeeded/failed states, semantic-input freshness metadata, per-draft rerun counts, section-scoped regeneration guidance, and sanitized per-run LLM diagnostics. |
| `applications.extracted_reference_id` | Lowercase or normalized requisition/reference identifier, for example `"req-42"` | Stores the reference identifier extracted during capture so duplicate detection can use a persisted signal instead of re-parsing URLs or descriptions later. |
| `applications.duplicate_match_fields` | Object with `matched_fields` array and `match_basis` string, for example `{"matched_fields": ["job_title", "company", "job_url"], "match_basis": "exact_job_url"}` | Stores what caused the duplicate warning, not the full comparison payload. `matched_fields` may include `job_posting_origin`, `job_url`, `reference_id`, or `job_description` only when those signals actually contributed to the duplicate warning. |
| `resume_drafts.generation_params` | Object with `page_length`, `aggressiveness`, and `additional_instructions`, for example `{"page_length": "1_page", "aggressiveness": "medium", "additional_instructions": null}` | `page_length` values: `1_page`, `2_page`, `3_page`. `aggressiveness` values: `low`, `medium`, `high`. |
| `resume_drafts.generation_params` subscription fields | Optional generated-draft metadata with `subscription_tier`, `quota_period_start`, and `model_used`, for example `{"subscription_tier": "basic", "quota_period_start": "2026-05-01", "model_used": "openai/gpt-5.4-mini"}` | Internal queued model and reasoning override fields must not be persisted in this JSON. Existing base-resume snapshot metadata may remain for compare/judge freshness compatibility. |
| `resume_drafts.sections_snapshot` | Object with `enabled_sections` and `section_order`, for example `{"enabled_sections": ["summary", "professional_experience", "projects"], "section_order": ["summary", "professional_experience", "projects"]}` | Snapshot of the eligible generated sections taken at generation time so later preference or base-resume changes do not rewrite old drafts implicitly. |
| `usage_events.metadata` (application activity timeline) | Object with required `activity_type` and optional `title`, `summary`, `details`, `failure_message`, and `attempts`, for example `{"activity_type": "generation_failed", "failure_message": "Validation failed.", "details": {"failure_stage": "validation", "attempt_count": 2}, "attempts": [{"model": "openai/gpt-5-mini", "reasoning_effort": "medium", "transport_mode": "responses", "outcome": "invalid_json", "elapsed_ms": 1200, "retry_reason": "invalid output"}]}` | User-facing activity metadata must be sanitized. `details` may include safe workflow diagnostics only (for example model, section, stage, duration, and validation summaries). Attempt entries are limited to `model`, `reasoning_effort`, `transport_mode`, `outcome`, `elapsed_ms`, and `retry_reason`. No raw resume/job content, auth artifacts, or provider payload dumps. |

## Table Definitions

### `users`

Application-managed user accounts (replaces Supabase GoTrue `users`).

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key. |
| `email` | `text` | No | — | Unique. Normalized to lowercase on write. |
| `password_hash` | `text` | No | — | bcrypt hash of the user's password. |
| `is_active` | `boolean` | No | `true` | Deactivated users are blocked from application access. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (email)`

**Delete behavior**

- Cascading deletes propagate to `profiles`, `base_resumes`, `applications`, `resume_drafts`, `notifications`, `user_invites`, and `usage_events`.

### `refresh_tokens`

Rotating refresh tokens for the JWT access/refresh token pattern.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
| `token_hash` | `text` | No | — | SHA-256 hash of the opaque refresh token. Unique. |
| `expires_at` | `timestamptz` | No | — | Token expiry timestamp. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `revoked_at` | `timestamptz` | Yes | `null` | Set when the token is revoked during rotation or logout. |

**Constraints**

- `UNIQUE (token_hash)`

**Behavior notes**

- Refresh tokens follow a rotation pattern: each refresh request revokes the old token and issues a new one.
- If a revoked token is reused, all tokens for that user are revoked (token reuse detection).

### `profiles`

Application-owned extension of `users`.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
 | `id` | `uuid` | No | — | Primary key. Foreign key to `users.id` with `ON DELETE CASCADE`. One profile per user. |
| `email` | `text` | No | — | Read-only mirror of user email for application queries. User-editing is not allowed. |
| `first_name` | `text` | Yes | `null` | Nullable until invite onboarding is completed. |
| `last_name` | `text` | Yes | `null` | Nullable until invite onboarding is completed. |
| `name` | `text` | Yes | `null` | Required by the product before final assembly/export, but nullable at rest until the user completes the profile. |
| `phone` | `text` | Yes | `null` | Nullable until user provides it. |
| `address` | `text` | Yes | `null` | Nullable until user provides it. Used as the short location line in resume assembly and export. |
| `linkedin_url` | `text` | Yes | `null` | Optional LinkedIn profile URL used in resume assembly and export. |
| `is_admin` | `boolean` | No | `false` | Grants access to admin routes and screens. |
| `is_active` | `boolean` | No | `true` | Deactivated users are blocked from application access. |
| `onboarding_completed_at` | `timestamptz` | Yes | `null` | Set when invite signup is accepted successfully. |
| `subscription_tier` | `text` | No | `basic` | FK to `subscription_tiers.key`. Determines monthly resume-writing quota and generation model access. |
| `default_base_resume_id` | `uuid` | Yes | `null` | Canonical pointer to the user's default base resume. Composite foreign key with `id` to `base_resumes (id, user_id)` and `ON DELETE SET NULL`. |
| `section_preferences` | `jsonb` | No | `{"summary": true, "professional_experience": true, "education": true, "skills": true, "projects": true, "certifications": true}` | See JSON contract above. |
| `section_order` | `jsonb` | No | `["summary", "professional_experience", "education", "skills", "projects", "certifications"]` | See JSON contract above. |
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
- `FOREIGN KEY (subscription_tier) REFERENCES subscription_tiers (key)`
- Unique partial index on `extension_token_hash` when present

### `subscription_tiers`

Admin-configurable Basic and Pro generation limits and model access.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `key` | `text` | No | — | Primary key. Allowed values are `basic` and `pro`. |
| `name` | `text` | No | — | Display label. |
| `monthly_resume_generation_limit` | `integer` | No | — | UTC calendar-month limit for initial generation, full regeneration, and section regeneration. Must be non-negative; backend validation caps admin-entered values. |
| `generation_model` | `text` | No | — | OpenRouter model ID used as the tier primary generation model. Must be one of the curated admin model options. |
| `generation_reasoning_effort` | `text` | No | `none` | OpenRouter reasoning effort for the primary model. Model-aware allowed values are `none`, `low`, `medium`, `high`, and `xhigh`; DeepSeek V4 Flash allows only `none`, `high`, and `xhigh`. |
| `generation_fallback_model` | `text` | No | — | OpenRouter model ID used as the tier fallback generation model. Must differ from `generation_model` and be one of the curated admin model options. |
| `generation_fallback_reasoning_effort` | `text` | No | `none` | OpenRouter reasoning effort for the fallback model with the same compatibility rules as the primary reasoning field. |
| `is_active` | `boolean` | No | `true` | Inactive tiers cannot reserve generation quota. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Seed values**

- `basic`: limit `10`, primary `google/gemini-3-flash-preview` with reasoning `none`, fallback `openai/gpt-5.4-mini` with reasoning `none`
- `pro`: limit `100`, primary `openai/gpt-5.4-mini` with reasoning `medium`, fallback `google/gemini-3.5-flash` with reasoning `medium`

### `resume_generation_usage`

Monthly quota counter for resume-writing operations.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `user_id` | `uuid` | No | — | FK to `users.id` with `ON DELETE CASCADE`. |
| `period_start` | `date` | No | — | First day of the UTC calendar month. |
| `generation_count` | `integer` | No | `0` | Count of successfully reserved resume-writing jobs for the period. Must be non-negative. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `PRIMARY KEY (user_id, period_start)`
- `CHECK (generation_count >= 0)`

**Isolation requirements**

- Queries must scope by `id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer; no table-level RLS is used.

### `base_resumes`

Stored Markdown source resumes owned by a single user.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
| `name` | `text` | No | — | User-defined label. Must be non-blank. |
| `content_md` | `text` | No | — | Full resume stored as Markdown. Must be non-blank. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (id, user_id)` to support same-user composite foreign keys.
- `CHECK (btrim(name) <> '')`
- `CHECK (btrim(content_md) <> '')`

**Isolation requirements**

- Queries must scope by `user_id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer.

**Delete behavior**

- Deleting a base resume clears `profiles.default_base_resume_id`.
- Deleting a base resume clears `applications.base_resume_id`.
- Existing applications remain valid after the reference is cleared.

### `applications`

User-owned job application records and workflow state.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
| `job_url` | `text` | Yes | `null` | Source URL used for extraction when provided. Must be non-blank when present. |
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
| `full_regeneration_count` | `integer` | No | `0` | Legacy per-application counter retained for compatibility. Subscription quota now governs resume-writing limits. |
| `exported_at` | `timestamptz` | Yes | `null` | Last successful export timestamp for the application, regardless of supported export format. |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp. |
| `updated_at` | `timestamptz` | No | `now()` | Must update on every write. |

**Constraints**

- `UNIQUE (id, user_id)` to support same-user composite foreign keys.
- `CHECK (job_url IS NULL OR btrim(job_url) <> '')`
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
- `full_regeneration_count` is retained for historical compatibility. New quota enforcement uses `resume_generation_usage` for initial generation, full regeneration, and section regeneration.
- `resume_judge_result.input_signature` is the primary stale-result fence. Backend code computes it from normalized draft markdown, normalized job context, judge-relevant generation settings, and the effective base-resume fingerprint so export-only writes and other non-semantic row touches do not stale the score.
- `resume_judge_result.evaluated_draft_updated_at` remains for callback observability and legacy mixed-row compatibility, but it is no longer the primary freshness authority for current reads.
- `resume_judge_result.run_attempt_count` counts queued Resume Judge runs for the current semantic input only. It resets when the computed `input_signature` changes and must stop manual reruns after the third queued attempt.
- API detail responses may add a computed `resume_judge_result.is_stale` flag for UI consumption; that flag is response-only and is not persisted in `applications.resume_judge_result`.
- The backend must clear stale `failure_reason` values when a recoverable workflow succeeds.

**Isolation requirements**

- Queries must scope by `user_id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer.

### `resume_drafts`

Single current Markdown draft for one application.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `application_id` | `uuid` | No | — | Foreign key to the owning application. Composite foreign key with `user_id` to `applications (id, user_id)` and `ON DELETE CASCADE`. |
| `user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
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

**Isolation requirements**

- Queries must scope by `user_id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer.

### `notifications`

In-app workflow notifications for a single user.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | — | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
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

**Isolation requirements**

- Queries must scope by `user_id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer.

### `user_invites`

Invite lifecycle records for invite-only onboarding.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key. |
| `invitee_user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
| `invited_by_user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
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

**Isolation requirements**

- Queries must scope by `invitee_user_id` or `invited_by_user_id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer.

### `usage_events`

Sanitized user-scoped event stream for admin metrics and workflow telemetry.

| Column | Type | Null | Default | Constraints and notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key. |
| `user_id` | `uuid` | No | — | Foreign key to `users.id` with `ON DELETE CASCADE`. |
| `application_id` | `uuid` | Yes | `null` | Foreign key to `applications.id` with `ON DELETE SET NULL`. |
| `event_type` | `text` | No | — | Operation/event key (for example extraction, generation, regeneration, export, or `application_activity`). |
| `event_status` | `usage_event_status_enum` | No | — | `success`, `failure`, or `info`. |
| `metadata` | `jsonb` | No | `'{}'::jsonb` | Sanitized metadata only. |
| `created_at` | `timestamptz` | No | `now()` | Event timestamp. |

**Constraints**

- `CHECK (btrim(event_type) <> '')`

**Isolation requirements**

- Queries must scope by `user_id` matching the authenticated user's ID.
- Backend enforces isolation at the application layer.

## Relationship and Delete Semantics

| Relationship | Rule |
|---|---|
| `profiles.id -> users.id` | `ON DELETE CASCADE` |
| `base_resumes.user_id -> users.id` | `ON DELETE CASCADE` |
| `applications.user_id -> users.id` | `ON DELETE CASCADE` |
| `resume_drafts.user_id -> users.id` | `ON DELETE CASCADE` |
| `notifications.user_id -> users.id` | `ON DELETE CASCADE` |
| `resume_generation_usage.user_id -> users.id` | `ON DELETE CASCADE` |
| `user_invites.invitee_user_id -> users.id` | `ON DELETE CASCADE` |
| `user_invites.invited_by_user_id -> users.id` | `ON DELETE CASCADE` |
| `usage_events.user_id -> users.id` | `ON DELETE CASCADE` |
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
| `resume_generation_usage (period_start)` | Monthly quota audit and cleanup queries |
| `user_invites (invitee_user_id)` partial unique index on pending rows | Prevent multiple active pending invites per user |
| `user_invites (status, created_at DESC)` | Admin invite lifecycle filtering and counts |
| `user_invites (invited_by_user_id, created_at DESC)` | Admin inviter activity and audit retrieval |
| `usage_events (event_type, created_at DESC)` | Metrics aggregation for workflow events |
| `usage_events (user_id, created_at DESC)` | User-scoped metrics and event drill-down |
| `usage_events (application_id, created_at DESC)` | Application event history lookups |

The exact Postgres index type may vary by implementation. For dashboard search, use an index strategy compatible with the final search behavior, such as trigram or full-text search.

## User Isolation Strategy

Row-Level Security (RLS) has been removed. The backend enforces per-user isolation at the application layer by scoping every query with an explicit `user_id` parameter. This applies to all reads, writes, background jobs, notifications, and exports.

Key rules:

- Every repository query includes `WHERE user_id = %s` (or equivalent) derived from the authenticated JWT.
- No endpoint, background worker, or notification path may access data outside the authenticated user's boundary.
- The database connection pool uses a single application-level role; there is no per-user database role.

## Implementation Notes

- Use `timestamptz` for all timestamps.
- Maintain `updated_at` automatically on write through a shared trigger or equivalent backend discipline.
- Keep enum names and values aligned with the PRD status model; do not introduce alternate status labels.
- Preserve `job_title`, `company`, `job_description`, `job_location_text`, `compensation_text`, and `job_posting_origin` as nullable until extraction or manual entry succeeds, while allowing `job_posting_origin` to remain `NULL` when the source cannot be classified yet.
- Do not add persistent PDF storage columns or tables for MVP.
