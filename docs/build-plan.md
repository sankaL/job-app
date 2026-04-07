# AI Resume Builder Build Plan

**Document status:** Active roadmap  
**Last updated:** 2026-04-06 21:08:42 EDT  
**Implementation status:** Planning complete; implementation not started  
**Primary product source:** `docs/resume_builder_PRD_v3.md`  
**Database contract:** `docs/database_schema.md`

This roadmap assumes a greenfield implementation. The current repository contains product requirements and agent guidance, but no committed frontend, backend, or Supabase application code yet.

## Planning Defaults

- Build the MVP as a private, invite-only product with authenticated access only.
- Keep all user data explicitly scoped by `user_id` and protected by Supabase RLS.
- Store all base resumes and generated drafts as Markdown.
- Keep `applied` separate from the primary application status.
- Treat `docs/database_schema.md` as the schema source of truth.
- Defer dedicated async job/progress tables until the background worker strategy is chosen during implementation.
- Keep a single current draft per application for MVP. No resume version-history UI or schema is planned.

## Phase Summary

| Phase | Status | Outcome |
|---|---|---|
| Phase 0 | Planned | Foundation, auth boundary, schema, and shared workflow contract |
| Phase 1 | Planned | Application intake, extraction, manual fallback, and duplicate review |
| Phase 2 | Planned | Base resumes, profile data, section preferences, and generation setup |
| Phase 3 | Planned | Generation, validation, assembly, notifications, and application workspace |
| Phase 4 | Planned | Editing, regeneration, and PDF export |
| Phase 5 | Planned | Hardening, recovery, and end-to-end MVP acceptance |

## Phase 0 — Foundation, Auth Boundary, and Schema

**Scope**

- Scaffold the committed stack: React + Vite + Tailwind CSS + `shadcn`, FastAPI, Supabase, and prompt-layer assets under `agents/`.
- Implement the invite-only login surface with Supabase email/password auth.
- Establish protected frontend routes and a protected backend API boundary.
- Create the initial Postgres schema, enums, and RLS policies from `docs/database_schema.md`.
- Centralize the PRD status vocabulary so frontend, backend, and background work use the same visible statuses, internal states, and failure reasons.

**Dependencies**

- `docs/resume_builder_PRD_v3.md`
- `docs/database_schema.md`

**Decision Gates**

- Select the background job strategy with persistence appropriate for Railway.
- Select the real-time progress delivery model for long-running extraction and generation work.
- Confirm the OpenRouter primary/fallback model integration path through LangChain.

**Deliverables**

- Protected app shell and authenticated session flow.
- Backend auth middleware and per-request user resolution from Supabase JWTs.
- Initial database migration set with RLS enabled on all user-scoped tables.
- Shared status constants/types used across frontend and backend.

**Exit Criteria**

- An invited user can authenticate and reach protected application routes.
- Unauthenticated requests are rejected everywhere except the login surface.
- No auth tokens are stored in browser `localStorage`.
- All user tables exist with owner-scoped RLS policies.

**PRD Acceptance Coverage**

- Log in to an invite-only app with email and password.

## Phase 1 — Application Intake, Extraction, and Duplicate Review

**Scope**

- Build the applications dashboard with loading, empty-state, search, filter, sort, and inline `applied` toggle support.
- Implement the New Application flow with URL-only submission.
- Create draft applications immediately, then launch async job extraction with progress feedback.
- Support extraction success, extraction failure, retry extraction, and manual entry fallback.
- Run duplicate detection after extraction success or manual entry completion.
- Persist duplicate warning details, show the matching application link, and allow permanent dismissal for the new application.

**Dependencies**

- Phase 0 auth boundary and schema
- Background worker baseline from Phase 0

**Decision Gates**

- Confirm Playwright packaging and runtime behavior on Railway.
- Set the configurable duplicate threshold and candidate-selection approach around `rapidfuzz`.

**Deliverables**

- Dashboard list and detail navigation for applications.
- Application creation endpoint and extraction job orchestration.
- Manual entry form and retry extraction control.
- Duplicate warning UI with persisted resolution state.
- In-app and email notifications for extraction problems, including manual-entry-required cases.

**Exit Criteria**

- A user can create a new application from a job link.
- Extraction either populates the application or routes the user into a recoverable manual-entry path.
- Duplicate review blocks generation until resolved or dismissed.
- Dashboard badges reflect unresolved duplicate and action-required states.

**PRD Acceptance Coverage**

- Create a new application from a job link.
- Receive automatic extraction or be routed to manual entry on failure.
- See duplicate overlap warnings with similarity score, matched fields, and a link to the existing application.
- Dismiss a duplicate warning permanently.

## Phase 2 — Base Resumes, Profile, Preferences, and Generation Setup

**Scope**

- Build base resume creation, editing, deletion, and default selection flows.
- Support base resume creation from file upload and structured form input.
- Persist and edit user personal information needed for assembly and export.
- Persist section enablement preferences and section order preferences.
- Implement the pre-generation configuration surface for target length, aggressiveness, additional instructions, and base resume selection.

**Dependencies**

- Phase 0 schema and auth
- Phase 1 application detail and duplicate resolution path

**Decision Gates**

- Confirm the document-ingestion path for `.docx` and `.pdf` conversion to Markdown.
- Decide whether an optional LLM cleanup pass is needed after file parsing.

**Deliverables**

- Base resume CRUD APIs and screens.
- Resume upload parsing pipeline and structured form assembler to Markdown.
- User profile and section-preferences screens.
- Generation setup form with default-base-resume behavior.

**Exit Criteria**

- A user can manage one or more base resumes.
- A user can set and change a default base resume.
- Personal information can be stored without LLM generation.
- Section preferences affect future generations only unless the user explicitly regenerates.

**PRD Acceptance Coverage**

- Manage base resumes (create via file upload or form, edit, delete, set default).
- Select a base resume and generation settings before generating.

## Phase 3 — Generation, Validation, Assembly, Notifications, and Workspace

**Scope**

- Build the application detail page as the main resume workspace.
- Implement section-based resume generation through LangChain and OpenRouter.
- Run the validation layer over combined output before assembly.
- Assemble final Markdown by injecting profile personal information and ordered enabled sections.
- Save the current draft, update statuses, and create the required in-app and email notifications.
- Render generated Markdown in preview mode and keep the `applied` flag independent from the visible status.

**Dependencies**

- Phase 2 base resume content and user profile data
- Phase 0 shared status contracts and background job foundation

**Decision Gates**

- Confirm the Markdown rendering library for the frontend preview mode.
- Lock the exact validator output contract used between prompt assets and backend orchestration.

**Deliverables**

- Section-based generation service with configurable primary and fallback models.
- Validation service enforcing hallucination, section presence, order, and ATS-safety rules.
- Resume assembly path writing `resume_drafts`.
- Application detail page with status badge, job info, notifications, preview mode, and `applied` toggle behavior.

**Exit Criteria**

- A user can generate an ATS-friendly Markdown resume from a selected base resume and job posting.
- Validation failures leave a recoverable `Needs Action` state with notifications.
- Successful generation lands the application in `In Progress`.
- The preview mode reflects the latest saved Markdown draft.

**PRD Acceptance Coverage**

- Generate an ATS-friendly Markdown resume via LangChain + OpenRouter.
- View the resume in rendered preview mode.
- Toggle the Applied flag independently of the primary status.
- Receive in-app notifications for workflow events.
- Receive email notifications for high-signal generation events.

## Phase 4 — Editing, Regeneration, and PDF Export

**Scope**

- Implement Markdown edit mode with persistent save behavior.
- Support single-section regeneration with required instructions.
- Support full regeneration with pre-filled prior settings and overwrite of the current draft.
- Implement on-demand PDF export from the latest draft content with ATS-safe formatting.
- Preserve the PRD rule that editing or regenerating after export returns the visible status to `In Progress`.
- Handle regeneration and export failures with recoverable status changes and notifications.

**Dependencies**

- Phase 3 generation, validation, and draft persistence

**Decision Gates**

- Select the PDF rendering engine and validate ATS-safe output quality.

**Deliverables**

- Markdown editor mode and preview/edit mode switch.
- Section regeneration endpoint and validator path.
- Full regeneration path that overwrites the current draft and updates timestamps.
- PDF export endpoint that streams the generated file without storing it.
- In-app notifications for export success and failure, plus email notifications for export failures.

**Exit Criteria**

- A user can edit and save Markdown directly.
- Section regeneration rejects blank instructions and updates only the selected section.
- Full regeneration reuses and updates prior settings appropriately.
- PDF export produces a fresh file from the latest saved draft and does not persist the PDF.
- Editing or regeneration after export returns the application to `In Progress`.

**PRD Acceptance Coverage**

- Edit the resume in plain Markdown mode and save.
- Regenerate a single section with required instructions.
- Regenerate the full resume with updated settings and optional instructions.
- Export the current draft as a PDF download.
- See status return to `In Progress` after editing or regenerating a previously exported resume.

## Phase 5 — Hardening, Recovery, and MVP Acceptance

**Scope**

- Add timeout boundaries, bounded retries, stop conditions, and cleanup behavior for all async flows.
- Verify failure recovery paths for extraction, manual entry, generation, regeneration, and export.
- Add regression coverage where test surfaces exist for status mapping, user scoping, duplicate dismissal, and export freshness.
- Validate that logging stays structured and sanitized.
- Run an end-to-end acceptance sweep against the PRD and keep product and schema docs aligned.

**Dependencies**

- Phases 0 through 4

**Decision Gates**

- None should remain open at phase entry; unresolved findings become release blockers.

**Deliverables**

- Timeout and retry implementations for extraction, generation, regeneration, and export.
- Regression and integration coverage for core workflow paths.
- A release-readiness checklist tied to PRD acceptance criteria.
- Updated rollout and migration guidance when real schema migrations land.

**Exit Criteria**

- All timeout contracts from the PRD are enforced.
- All recoverable failure states surface clear user next steps.
- All PRD acceptance criteria have a passing implementation path.
- Documentation remains aligned across PRD, schema, and migration runbook.

**PRD Acceptance Coverage**

- All MVP acceptance criteria must pass at least one automated or manual verification path before release.

## Acceptance Traceability

| PRD acceptance item | Owning phase |
|---|---|
| Log in to an invite-only app with email and password | Phase 0 |
| Create a new application from a job link | Phase 1 |
| Receive automatic extraction or be routed to manual entry on failure | Phase 1 |
| See duplicate overlap warnings with similarity score, matched fields, and a link to the existing application | Phase 1 |
| Dismiss a duplicate warning permanently | Phase 1 |
| Select a base resume and generation settings before generating | Phase 2 |
| Generate an ATS-friendly Markdown resume via LangChain + OpenRouter | Phase 3 |
| View the resume in rendered preview mode | Phase 3 |
| Edit the resume in plain Markdown mode and save | Phase 4 |
| Regenerate a single section with required instructions | Phase 4 |
| Regenerate the full resume with updated settings and optional instructions | Phase 4 |
| Export the current draft as a PDF download | Phase 4 |
| See status return to `In Progress` after editing or regenerating a previously exported resume | Phase 4 |
| Toggle the Applied flag independently of the primary status | Phase 1 and Phase 3 |
| Receive in-app notifications for all workflow events | Phase 1, Phase 3, and Phase 4 |
| Receive email notifications for high-signal events | Phase 1, Phase 3, and Phase 4 |
| Manage base resumes (create via file upload or form, edit, delete, set default) | Phase 2 |

## Notes for Future Task Updates

- Update each phase status and this document timestamp as implementation progresses.
- When a task changes schema, rollout order, compatibility, backfills, or post-deploy checks, update `docs/backend-database-migration-runbook.md` in the same task.
- Keep `docs/database_schema.md` and `docs/resume_builder_PRD_v3.md` aligned whenever status models, data contracts, or workflow behavior changes.
