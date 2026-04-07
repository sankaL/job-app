# AI Resume Builder Build Plan

**Document status:** Active roadmap  
**Last updated:** 2026-04-07 12:06:48 EDT  
**Implementation status:** Phase 0 implemented; later phases pending  
**Primary product source:** `docs/resume_builder_PRD_v3.md`  
**Database contract:** `docs/database_schema.md`

This roadmap now includes the committed Phase 0 foundation: frontend and backend app scaffolds, a worker baseline, shared workflow contract assets, and a repo-owned local Docker stack. Later phases remain unimplemented.

## Planning Defaults

- Build the MVP as a private, invite-only product with authenticated access only.
- Keep all user data explicitly scoped by `user_id` and protected by Supabase RLS.
- Store all base resumes and generated drafts as Markdown.
- Keep `applied` separate from the primary application status.
- Treat `docs/database_schema.md` as the schema source of truth.
- Local development and testing must run through a Dockerized, Makefile-managed stack.
- Dev mode must use local Supabase services; production must connect to the hosted Supabase instance directly.
- Defer dedicated async job/progress tables until the background worker strategy is chosen during implementation.
- Keep a single current draft per application for MVP. No resume version-history UI or schema is planned.

## Phase Summary

| Phase | Status | Outcome |
|---|---|---|
| Phase 0 | Implemented | Foundation, containerized local stack, auth boundary, schema, and shared workflow contract |
| Phase 1 | Planned | Application intake, extraction, manual fallback, and duplicate review |
| Phase 2 | Planned | Base resumes, profile data, section preferences, and generation setup |
| Phase 3 | Planned | Generation, validation, assembly, notifications, and application workspace |
| Phase 4 | Planned | Editing, regeneration, and PDF export |
| Phase 5 | Planned | Hardening, recovery, and end-to-end MVP acceptance |

## Task Tracking

These tables track implementation-sized tasks seeded from the phase roadmap below. The phase sections remain the planning source of truth.

### Phase 0 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P0-T01 | Scaffold the committed frontend, backend, and agents stack foundations | Infra | DONE | 2026-04-07 11:36:08 EDT | React/Vite/Tailwind frontend, FastAPI backend, and ARQ worker baseline are committed. |
| P0-T02 | Dockerize the local frontend, backend, agents, and Supabase dev stack with Makefile orchestration | Infra | DONE | 2026-04-07 11:36:08 EDT | Root Docker Compose, Makefile, migrations runner, health check, and local invite-user seed flow are committed. |
| P0-T03 | Build the invite-only login surface and protected frontend route shell | FE | DONE | 2026-04-07 11:36:08 EDT | Login-only surface, protected route guard, authenticated shell bootstrap, and sessionStorage Supabase persistence are implemented. |
| P0-T04 | Implement backend auth middleware and per-request user resolution from Supabase JWTs | BE | DONE | 2026-04-07 11:36:08 EDT | Bearer-token auth dependency, JWT verification with JWKS plus local-secret fallback, and session bootstrap endpoint are implemented. |
| P0-T05 | Create the initial schema, enums, and owner-scoped RLS policies from the schema doc | BE | DONE | 2026-04-07 11:36:08 EDT | Initial SQL migration includes enums, tables, constraints, indexes, profile sync triggers, and RLS policies. |
| P0-T06 | Centralize shared status constants and workflow contract types across app layers | Other | DONE | 2026-04-07 11:36:08 EDT | Repo-level workflow contract JSON is loaded and validated in frontend, backend, and worker code. |

### Phase 1 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P1-T01 | Build the applications dashboard with loading, search, filter, sort, and inline applied toggle support | FE | TODO | 2026-04-07 | |
| P1-T02 | Implement new application creation from URL-only submission and draft record setup | BE | TODO | 2026-04-07 | |
| P1-T03 | Orchestrate async job extraction with progress, retry handling, and bounded recovery behavior | BE | TODO | 2026-04-07 | |
| P1-T04 | Build the manual entry fallback flow with job posting origin selection and editing for extraction failures | FE | TODO | 2026-04-07 | |
| P1-T05 | Add duplicate detection using job posting origin when available, plus persisted warning and dismissal tracking | BE | TODO | 2026-04-07 | |
| P1-T06 | Deliver in-app and email notifications for extraction problems and manual-entry-required states | BE | TODO | 2026-04-07 | |

### Phase 2 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P2-T01 | Implement base resume CRUD persistence, default selection, and user-scoped APIs | BE | TODO | 2026-04-07 | |
| P2-T02 | Build base resume, profile, and section preference management screens | FE | TODO | 2026-04-07 | |
| P2-T03 | Add resume ingestion for file upload and structured form input with Markdown output | BE | TODO | 2026-04-07 | |
| P2-T04 | Persist and apply user personal information, section enablement, and section order preferences | BE | TODO | 2026-04-07 | |
| P2-T05 | Create the pre-generation configuration surface for length, aggressiveness, instructions, and resume selection | FE | TODO | 2026-04-07 | |

### Phase 3 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P3-T01 | Build the application detail page as the primary resume workspace with preview and status context | FE | TODO | 2026-04-07 | |
| P3-T02 | Implement section-based resume generation through LangChain and OpenRouter with model fallback handling | AI | TODO | 2026-04-07 | |
| P3-T03 | Add validation for hallucinations, required sections, ordering, and ATS-safety before draft assembly | AI | TODO | 2026-04-07 | |
| P3-T04 | Assemble final Markdown using profile data and ordered enabled sections, then persist the current draft | BE | TODO | 2026-04-07 | |
| P3-T05 | Update statuses and send in-app and email notifications for generation outcomes and attention states | BE | TODO | 2026-04-07 | |
| P3-T06 | Preserve applied flag independence from the primary application status throughout the workspace flow | BE | TODO | 2026-04-07 | |

### Phase 4 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P4-T01 | Add Markdown edit mode with persistent saves and a preview or edit mode switch | FE | TODO | 2026-04-07 | |
| P4-T02 | Implement single-section regeneration with required instructions and validator enforcement | AI | TODO | 2026-04-07 | |
| P4-T03 | Implement full regeneration with prefilled prior settings and overwrite of the current draft | AI | TODO | 2026-04-07 | |
| P4-T04 | Build on-demand PDF export from the latest draft content without persistent PDF storage | BE | TODO | 2026-04-07 | |
| P4-T05 | Return status to In Progress after edits or regeneration and handle regen or export notifications | BE | TODO | 2026-04-07 | |

### Phase 5 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P5-T01 | Enforce timeout boundaries, bounded retries, stop conditions, and cleanup across async workflows | BE | TODO | 2026-04-07 | |
| P5-T02 | Add regression coverage for status mapping, user scoping, duplicate dismissal, and export freshness | Other | TODO | 2026-04-07 | |
| P5-T03 | Validate recoverable failure paths for extraction, manual entry, generation, regeneration, and export | Other | TODO | 2026-04-07 | |
| P5-T04 | Verify structured logging remains sanitized and free of sensitive user content in production paths | Infra | TODO | 2026-04-07 | |
| P5-T05 | Run MVP acceptance verification and align supporting docs, schema guidance, and migration runbook updates | Docs | TODO | 2026-04-07 | |

### Bug Fixes

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|

### Ad-hoc

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| A0-T01 | Simplify the local env contract, disable local auth emails, and add the backend Resend send gate | Infra | DONE | 2026-04-07 12:06:48 EDT | Root env is now canonical, local GoTrue mail delivery is disabled, and backend email sending is gated by `EMAIL_NOTIFICATIONS_ENABLED`. |

## Phase 0 — Foundation, Containerization, Auth Boundary, and Schema

**Scope**

- Scaffold the committed stack: React + Vite + Tailwind CSS + `shadcn`, FastAPI, Supabase, and prompt-layer assets under `agents/`.
- Dockerize the local development stack with separate containers for frontend, backend, agents, and local Supabase services.
- Add a dedicated dev-mode environment switch that points the app at the local Dockerized stack for testing and keeps production on the hosted Supabase instance.
- Implement the invite-only login surface with Supabase email/password auth.
- Establish protected frontend routes and a protected backend API boundary.
- Create the initial Postgres schema, enums, and RLS policies from `docs/database_schema.md`.
- Centralize the PRD status vocabulary so frontend, backend, and background work use the same visible statuses, internal states, and failure reasons.
- Add a repository-level Makefile as the single entrypoint for local development and testing workflows.

**Dependencies**

- `docs/resume_builder_PRD_v3.md`
- `docs/database_schema.md`

**Decision Gates**

- Select the background job strategy with persistence appropriate for Railway.
- Select the real-time progress delivery model for long-running extraction and generation work.
- Confirm the OpenRouter primary/fallback model integration path through LangChain.
- Decide whether the local Supabase stack is managed via the official Supabase CLI containers or an equivalent Docker Compose orchestration owned by the repo.

**Deliverables**

- Protected app shell and authenticated session flow.
- Backend auth middleware and per-request user resolution from Supabase JWTs.
- Initial database migration set with RLS enabled on all user-scoped tables.
- Shared status constants/types used across frontend and backend.
- Docker assets for the frontend container, backend container, agents container, and local Supabase-backed dev stack.
- A Makefile with the local development and test orchestration targets required to boot, stop, reset, and verify the Dockerized stack from one entrypoint.
- Local scripts referenced by the Makefile for repeatable container startup, teardown, health checking, and local test preparation where those flows would otherwise become ad-hoc shell commands.

**Exit Criteria**

- An invited user can authenticate and reach protected application routes.
- Unauthenticated requests are rejected everywhere except the login surface.
- No auth tokens are stored in browser `localStorage`.
- All user tables exist with owner-scoped RLS policies.
- A developer can start the full local stack through the Makefile and get frontend, backend, agents, and local Supabase services running together.
- Local dev mode does not connect to production Supabase Auth or the production Supabase database.
- Production configuration is documented to use the hosted Supabase instance directly rather than local containers.

**PRD Acceptance Coverage**

- Log in to an invite-only app with email and password.

**Phase 0 Local Stack Requirements**

- Frontend runs in its own container.
- Backend runs in its own container.
- Agents orchestration runs in its own container.
- Local Supabase services run in Docker for development and test environments only.
- The Makefile is the source of truth for local stack lifecycle tasks instead of ad-hoc startup commands.
- The Makefile should cover, at minimum, stack boot, stack shutdown, stack reset, logs, health verification, and local test preparation tasks.

## Phase 1 — Application Intake, Extraction, and Duplicate Review

**Scope**

- Build the applications dashboard with loading, empty-state, search, filter, sort, and inline `applied` toggle support.
- Implement the New Application flow with URL-only submission.
- Create draft applications immediately, then launch async job extraction with progress feedback.
- Support extraction success, extraction failure, retry extraction, and manual entry fallback, including normalized job posting origin capture.
- Allow job posting origin to be auto-populated when extractable, edited later from the application detail view, and manually selected during manual entry.
- Run duplicate detection after extraction success or manual entry completion, using job posting origin when it is available.
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
- Manual entry form and retry extraction control, including the job posting origin dropdown and conditional `Other` label.
- Duplicate warning UI with persisted resolution state.
- In-app and email notifications for extraction problems, including manual-entry-required cases.

**Exit Criteria**

- A user can create a new application from a job link.
- Extraction either populates the application or routes the user into a recoverable manual-entry path.
- Job posting origin is saved automatically when extractable and can be added or corrected manually without breaking the workflow.
- Duplicate review blocks generation until resolved or dismissed.
- Dashboard badges reflect unresolved duplicate and action-required states.

**PRD Acceptance Coverage**

- Create a new application from a job link.
- Receive automatic extraction or be routed to manual entry on failure.
- Capture job posting origin automatically when possible and allow manual selection later when needed.
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
| Capture job posting origin automatically when possible and allow manual selection later when needed | Phase 1 |
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
