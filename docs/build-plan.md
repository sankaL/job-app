# AI Resume Builder Build Plan

**Document status:** Active roadmap  
**Last updated:** 2026-04-08  
**Implementation status:** Phases 0 through 4 implemented; Phase 5 pending  
**Primary product source:** `docs/resume_builder_PRD_v3.md`  
**Database contract:** `docs/database_schema.md`

This roadmap now includes the committed Phase 0 foundation, the committed Phase 1 application-intake workflow, the committed Phase 1A blocked-site recovery plus Chrome extension intake follow-on, Phase 2 base resumes and profile preferences, Phase 3 generation/validation/assembly, and Phase 4 editing/regeneration/export. Phase 5 hardening remains unimplemented.

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
| Phase 1 | Implemented | Application intake, extraction, manual fallback, duplicate review, and extraction-problem notifications |
| Phase 1A | Implemented | Blocked-page recovery, pasted-text retry, and Chrome current-tab capture intake |
| Phase 2 | Implemented | Base resumes, profile data, section preferences, PDF upload with optional LLM cleanup, and pre-generation configuration surface |
| Phase 3 | Implemented | Generation, validation, assembly, notifications, and application workspace |
| Phase 4 | Implemented | Editing, regeneration, and PDF export |
| Phase 5 | Planned | Hardening, recovery, and end-to-end MVP acceptance |

## Task Tracking

These tables track implementation-sized tasks seeded from the phase roadmap below. The phase sections remain the planning source of truth.

### Phase 0 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| B0-T01 | Fail closed when local Supabase exposes an empty JWKS set during backend JWT verification | BE | DONE | 2026-04-07 13:38:00 EDT | Auth verification now treats empty JWKS responses like other key-fetch failures, falls back to the configured shared secret when available, and has regression coverage for both fallback and fail-closed paths. |
| P0-T01 | Scaffold the committed frontend, backend, and agents stack foundations | Infra | DONE | 2026-04-07 11:36:08 EDT | React/Vite/Tailwind frontend, FastAPI backend, and ARQ worker baseline are committed. |
| P0-T02 | Dockerize the local frontend, backend, agents, and Supabase dev stack with Makefile orchestration | Infra | DONE | 2026-04-07 11:36:08 EDT | Root Docker Compose, Makefile, migrations runner, health check, and local invite-user seed flow are committed. |
| P0-T03 | Build the invite-only login surface and protected frontend route shell | FE | DONE | 2026-04-07 11:36:08 EDT | Login-only surface, protected route guard, authenticated shell bootstrap, and sessionStorage Supabase persistence are implemented. |
| P0-T04 | Implement backend auth middleware and per-request user resolution from Supabase JWTs | BE | DONE | 2026-04-07 11:36:08 EDT | Bearer-token auth dependency, JWT verification with JWKS plus local-secret fallback, and session bootstrap endpoint are implemented. |
| P0-T05 | Create the initial schema, enums, and owner-scoped RLS policies from the schema doc | BE | DONE | 2026-04-07 11:36:08 EDT | Initial SQL migration includes enums, tables, constraints, indexes, profile sync triggers, and RLS policies. |
| P0-T06 | Centralize shared status constants and workflow contract types across app layers | Other | DONE | 2026-04-07 11:36:08 EDT | Repo-level workflow contract JSON is loaded and validated in frontend, backend, and worker code. |

### Phase 1 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P1-T01 | Build the applications dashboard with loading, search, filter, sort, and inline applied toggle support | FE | DONE | 2026-04-07 13:15:06 EDT | Dashboard route now lists user-scoped applications with empty/loading states, local filter/sort controls, duplicate and attention badges, and optimistic applied toggles. |
| P1-T02 | Implement new application creation from URL-only submission and draft record setup | BE | DONE | 2026-04-07 13:15:06 EDT | URL-only creation now creates the draft row immediately, seeds extraction progress, and redirects to the detail page. |
| P1-T03 | Orchestrate async job extraction with progress, retry handling, and bounded recovery behavior | BE | DONE | 2026-04-07 13:15:06 EDT | ARQ extraction jobs now drive Redis-backed polling progress, internal worker callbacks, retry flow, timeout/error fallback, and title+description validation. |
| P1-T04 | Build the manual entry fallback flow with job posting origin selection and editing for extraction failures | FE | DONE | 2026-04-07 13:15:06 EDT | Detail page now exposes retry extraction, manual-entry-required recovery, editable origin handling, and conditional Other labels. |
| P1-T05 | Add duplicate detection using job posting origin when available, plus persisted warning and dismissal tracking | BE | DONE | 2026-04-07 13:15:06 EDT | Duplicate review now uses confidence scoring across title/company plus origin, URL, reference-id, and description signals with persisted dismissal or redirect state. |
| P1-T06 | Deliver in-app and email notifications for extraction problems and manual-entry-required states | BE | DONE | 2026-04-07 13:15:06 EDT | Extraction failures now mark active action-required notifications, clear them on recovery, and send the gated Resend email notification. |

### Phase 1A Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P1A-T01 | Detect blocked pages explicitly and persist sanitized failure diagnostics on applications | BE | DONE | 2026-04-07 15:30:43 EDT | Worker extraction now classifies blocked pages before LLM extraction and stores provider, reference ID, blocked URL, and detection timestamp in `applications.extraction_failure_details`. |
| P1A-T02 | Add pasted-text recovery so extraction can rerun from user-supplied source content | BE | DONE | 2026-04-07 15:30:43 EDT | Application detail now supports authenticated source-text recovery that requeues extraction from pasted content and clears stale blocked-failure state on success. |
| P1A-T03 | Build the blocked-source recovery UI with diagnostics, pasted-text retry, and manual fallback continuity | FE | DONE | 2026-04-07 15:30:43 EDT | Detail page now shows blocked-source diagnostics, pasted-text retry, URL retry, and the existing manual-entry flow in one recovery surface. |
| P1A-T04 | Add scoped Chrome extension token bootstrap, revoke, and token-protected import endpoints | BE | DONE | 2026-04-07 15:30:43 EDT | Backend now issues revocable hashed extension tokens per profile, exposes connection status, and accepts extension imports through token-only routes. |
| P1A-T05 | Ship a Chrome Manifest V3 current-tab capture extension and app onboarding flow | FE | DONE | 2026-04-07 15:30:43 EDT | The app now includes Chrome extension onboarding, and the repo includes a load-unpacked MV3 extension bundle for current-tab capture and application creation. |

### Phase 2 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P2-T01 | Implement base resume CRUD persistence, default selection, and user-scoped APIs | BE | DONE | 2026-04-07 | Base resume CRUD APIs (list, create, read, update, delete, set-default) implemented with repository, service, and API layers following Phase 1 patterns. |
| P2-T02 | Build base resume, profile, and section preference management screens | FE | DONE | 2026-04-07 | Base resume list and editor pages, profile and section preferences page, and navigation links added to the app shell. |
| P2-T03 | Add resume ingestion for file upload and structured form input with Markdown output | BE | DONE | 2026-04-07 | PDF upload parsing via pdfplumber with optional OpenRouter LLM cleanup for structural improvement. PDF-only for MVP; .docx deferred. |
| P2-T04 | Persist and apply user personal information, section enablement, and section order preferences | BE | DONE | 2026-04-07 | Profile PATCH API supports personal info (name, phone, address) and section preference (enablement, order) updates with validation. |
| P2-T05 | Create the pre-generation configuration surface for length, aggressiveness, instructions, and resume selection | FE | DONE | 2026-04-07 | Generation settings form on application detail page with base resume selection, target length, aggressiveness, and additional instructions. Generate button disabled pending Phase 3. |

### Phase 3 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P3-T01 | Build the application detail page as the primary resume workspace with preview and status context | FE | DONE | 2026-04-07 | Application detail page serves as the resume workspace with status badge, job info, generation settings, Markdown preview, and applied toggle. |
| P3-T02 | Implement structured single-call resume generation through LangChain and OpenRouter with model fallback handling | AI | DONE | 2026-04-08 08:39:33 EDT | Initial generation and full regeneration now use one OpenRouter call that returns ordered JSON sections, with a fallback retry only after provider failure or invalid structured output. |
| P3-T03 | Add deterministic validation for grounding, section order, ATS-safety, and contact-data leakage before draft assembly | AI | DONE | 2026-04-08 08:39:33 EDT | Schema validation plus rule-based checks now gate assembly, replacing the separate validation model call and rejecting contact leakage or unsupported claims. |
| P3-T04 | Assemble final Markdown using profile data and ordered enabled sections, then persist the current draft | BE | DONE | 2026-04-07 | Personal info header injection and ordered section assembly in agents/assembly.py, persisted to resume_drafts via DraftRepository. |
| P3-T05 | Update statuses and send in-app and email notifications for generation outcomes and attention states | BE | DONE | 2026-04-07 | Generation success/failure status transitions, in-app notifications, and email notifications for generation events. |
| P3-T06 | Preserve applied flag independence from the primary application status throughout the workspace flow | BE | DONE | 2026-04-07 | Applied flag remains independently user-controlled across all generation, editing, and export status transitions. |

### Phase 4 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| P4-T01 | Add Markdown edit mode with persistent saves and a preview or edit mode switch | FE | DONE | 2026-04-07 | Edit/preview toggle with inline Markdown editor, save to backend, and react-markdown preview with remark-gfm. |
| P4-T02 | Implement single-section regeneration with required instructions and deterministic validation | AI | DONE | 2026-04-08 08:39:33 EDT | Section regeneration now uses one sanitized model call for the selected section, validates deterministically, and updates only that section in the draft. |
| P4-T03 | Implement full regeneration with prefilled prior settings and overwrite of the current draft | AI | DONE | 2026-04-08 08:39:33 EDT | Full regeneration reuses saved draft settings from `generation_params`, runs the single-call JSON pipeline, and overwrites the current draft on success. |
| P4-T04 | Build on-demand PDF export from the latest draft content without persistent PDF storage | BE | DONE | 2026-04-07 | WeasyPrint-based PDF export with ATS-safe CSS, thread pool execution with 20s timeout, no persistent storage. |
| P4-T05 | Return status to Needs Action after edits or regeneration and handle regen or export notifications | BE | DONE | 2026-04-08 | Post-export edits/regeneration return status to needs_action (resume ready but export stale); export and regeneration notifications implemented. |

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
| B4-T15 | Block generation and regeneration when stored job data is a blocked-source placeholder | BE | DONE | 2026-04-08 20:06:08 EDT | Generation, full regeneration, and section regeneration now fail closed before queueing if the stored job title or description still looks like blocked-page placeholder text, moving the application back to `manual_entry_required` with blocked-source diagnostics and an action-required recovery notification instead of sending bad input to the LLM. |
| B4-T14 | Align full-draft generation timeouts with the PRD and preserve timeout failures through model fallback | AI/BE | DONE | 2026-04-08 19:54:26 EDT | Full generation and full regeneration now use a `90s` per-attempt LLM timeout instead of the section-level `45s` limit, single-section regeneration remains at `45s`, and provider timeouts now propagate as timeout-classified failures so the worker can surface `generation_timeout` or `regeneration_timeout` instead of a generic unexpected error. |
| B4-T13 | Fix dashboard load failures, shared-table paging/sort regressions, and stale shell application state after detail mutations | FE | DONE | 2026-04-08 16:17:58 EDT | Dashboard load errors now render a recovery state instead of the empty workspace, the shared data table clamps page state and applies sortable header ordering, and detail-page mutations plus terminal polling refresh the shell application cache so breadcrumbs and attention badges stay current. |
| B4-T12 | Tighten multi-line instruction screening and align low-aggressiveness length rules with minimal-change behavior | AI/BE | DONE | 2026-04-08 14:05:00 EDT | Generation instruction screening now normalizes textarea whitespace before policy checks, still blocks newline-separated override or fact-injection attempts, allows grounded title or company emphasis requests, and low aggressiveness no longer applies pruning-oriented bullet or skills caps that conflict with its preserve-the-source contract. |
| B4-T11 | Emit generation heartbeats during long reasoning calls so idle-timeout recovery does not fire on healthy runs | AI/BE | DONE | 2026-04-08 13:35:00 EDT | Full generation and full regeneration now emit periodic in-flight progress heartbeats while waiting on structured-output model calls, preventing the 90-second idle timeout from marking healthy long-running reasoning requests as stalled. |
| B4-T10 | Redesign prompts, enable generation-only OpenRouter reasoning, and add upload review warnings | AI/BE/FE | DONE | 2026-04-08 12:55:00 EDT | Resume generation now uses expert resume-writer prompts with section-specific aggressiveness and word budgets, generation-only reasoning through OpenRouter with structured-output fallback, stricter instruction validation, draft-context-aware section regeneration, extraction prompt hardening, and upload cleanup review warnings surfaced in the UI. |
| B4-T09 | Fix review regressions in fallback retry, grounding validation, and privacy sanitization | AI/BE | DONE | 2026-04-08 09:59:29 EDT | Fallback retry now resumes on schema-invalid model output, deterministic validation now checks unsupported role, employer, and credential claims in generated prose, markdown `# Name` headers are sanitized correctly, and upload cleanup no longer strips substantive project or publication URL lines from resume bodies. |
| B4-T08 | Allow grounded list-style supporting snippets without requiring exact contiguous source order | AI | DONE | 2026-04-08 09:35:16 EDT | Deterministic validation now accepts list-like skill snippets when their individual grounded terms exist in the sanitized source, avoiding false failures for shortened or reordered excerpts such as `SQL, Python, Java` or `Azure DevOps, CI/CD, Jenkins`. |
| B4-T07 | Make resume assembly null-safe for legacy or incomplete profile fields | AI | DONE | 2026-04-08 09:30:25 EDT | Assembly now coerces nullable personal-info fields to empty strings instead of calling `.strip()` on `None`, so existing applications with incomplete profile data no longer crash after a valid one-call generation response. |
| B4-T06 | Treat recoverable structured-output issues as local normalization instead of fallback-model retries | AI | DONE | 2026-04-08 09:24:20 EDT | Generation now truncates oversized `supporting_snippets` lists locally, explicitly asks for 1-6 snippets in the prompt, and only retries the fallback model on provider failures or unparseable JSON rather than on deterministic schema-validation issues. |
| B4-T05 | Normalize equivalent LLM JSON section shapes before schema validation so generation does not fail on wrapper differences | AI | DONE | 2026-04-08 09:14:40 EDT | The generation parser now accepts canonical `sections` arrays, `sections` maps, root-level section maps, and bare single-section payloads, normalizes them locally, and only falls back when the output is still structurally invalid after normalization. |
| B4-T03 | Fix JSONB application updates so terminal generation recovery can persist failure details | BE | DONE | 2026-04-07 23:19:59 EDT | `applications.update_application()` now wraps JSONB fields correctly for psycopg, allowing timeout and terminal-progress reconciliation paths to persist `generation_failure_details`, `extraction_failure_details`, and duplicate match metadata without 500s. |
| B4-T04 | Stop multi-call resume generation, keep contact data out of LLM prompts, and harden generation callbacks | BE/FE/AI | DONE | 2026-04-08 08:39:33 EDT | Resume writing now uses one structured LLM call per action, sanitizes contact/header data before external calls, reattaches it locally, retries callbacks with backoff, fences stale worker progress, and hydrates saved generation settings back into regeneration UX. |
| B4-T02 | Stop infinite generation polling loops and make full-generation timeout progress-aware | BE/FE/AI | DONE | 2026-04-07 23:07:06 EDT | Full generation now times out on stalled progress instead of a blunt 90-second wall-clock, stalled-job recovery runs from the progress endpoint, and the detail page stops polling after terminal progress even if the final detail refresh fails. |
| B4-T01 | Fix generation callback contract, active-state handling, and cancel or timeout failure compatibility | BE/FE/AI | DONE | 2026-04-07 22:45:00 EDT | Worker callbacks now match the backend payload contract, generation timeout and cancellation failure reasons are schema-safe, stale callbacks are fenced off after cancel or timeout, and the detail page no longer treats failed `generation_pending` rows as active jobs. |
| B1A-T01 | Persist extracted reference IDs from worker success callbacks and use them in duplicate detection | BE | DONE | 2026-04-07 15:51:23 EDT | Added `applications.extracted_reference_id`, persisted worker-extracted IDs, and updated duplicate detection to use the stored value before falling back to URL or description parsing. |
| B1A-T02 | Restore fail-closed application-state transitions and tighten Chrome extension bridge trust checks | BE/FE | DONE | 2026-04-07 16:02:40 EDT | Manual-entry PATCH edits no longer clear recovery state, duplicate resolution now requires a pending duplicate-review state, retry queue failures restore manual-entry progress/notifications, and the Chrome extension now accepts bridge messages only from trusted local or already-connected app origins. |

### Ad-hoc

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| A0-T02 | Document the latest live prompt catalog and variant permutations under `docs/prompts.md` | Docs | DONE | 2026-04-08 10:00:39 EDT | Added a code-derived prompt catalog covering extraction, resume generation, section regeneration, and upload cleanup, including the current prompt text, variant matrix, and dynamic section-permutation rules. |
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

## Phase 1A — Blocked-Page Recovery and Chrome Extension Intake

**Scope**

- Detect blocked pages explicitly before LLM extraction and persist sanitized blocked-source diagnostics on the application.
- Add pasted-text recovery so extraction can rerun from user-supplied source content before the user falls back to manual entry.
- Extend the application detail page with blocked-source recovery messaging, diagnostics, pasted-text retry, and the existing manual fallback.
- Add scoped Chrome extension token bootstrap, revoke, and token-protected import endpoints.
- Ship a Chrome Manifest V3 extension that captures the current tab and creates a new application in the authenticated app.

**Dependencies**

- Phase 1 application intake, progress polling, worker callback, and manual-entry baseline
- Existing user-scoped auth and notifications contracts from Phase 0 and Phase 1

**Deliverables**

- Additive schema migration for `applications.extraction_failure_details` and revocable extension-token fields on `profiles`.
- Worker blocked-page detection for Indeed- and Cloudflare-style block signals, including sanitized reference-ID extraction.
- Authenticated pasted-text recovery endpoint plus frontend recovery form on the application detail page.
- Chrome extension onboarding route in the app and a load-unpacked MV3 extension bundle under `frontend/public/chrome-extension/`.

**Exit Criteria**

- Blocked pages route the application into `manual_entry_required` with sanitized diagnostics and active attention state.
- Pasted-text recovery can rerun extraction and clear stale blocked-failure state on success.
- Revoking an extension token invalidates further extension imports immediately.
- Chrome current-tab capture can create a new application and open the detail page without using Supabase session tokens in the extension.

**PRD Acceptance Coverage**

- Create a new application from a connected Chrome current-tab capture.
- Receive blocked-source recovery with provider, reference ID, blocked URL, and pasted-text retry before manual entry.

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
- Implement structured single-call resume generation through LangChain and OpenRouter.
- Run deterministic schema and rule validation over generated output before assembly.
- Assemble final Markdown by injecting profile personal information and ordered enabled sections.
- Save the current draft, update statuses, and create the required in-app and email notifications.
- Render generated Markdown in preview mode and keep the `applied` flag independent from the visible status.

**Dependencies**

- Phase 2 base resume content and user profile data
- Phase 0 shared status contracts and background job foundation

**Decision Gates**

- Confirm the Markdown rendering library for the frontend preview mode.
- Lock the structured JSON contract used between prompt assets and backend orchestration.

**Deliverables**

- Single-call generation service with configurable primary and fallback models.
- Deterministic validation service enforcing schema compliance, grounding, section presence, order, ATS-safety, and contact-data exclusion.
- Resume assembly path writing `resume_drafts`.
- Application detail page with status badge, job info, notifications, preview mode, and `applied` toggle behavior.

**Exit Criteria**

- A user can generate an ATS-friendly Markdown resume from a selected base resume and job posting.
- Validation failures leave a recoverable `Needs Action` state with notifications.
- Successful generation lands the application in `Needs Action` (ready for review).
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
- Preserve the PRD rule that editing or regenerating after export returns the visible status to `Needs Action` (resume ready but export stale).
- Handle regeneration and export failures with recoverable status changes and notifications.

**Dependencies**

- Phase 3 generation, validation, and draft persistence

**Decision Gates**

- Select the PDF rendering engine and validate ATS-safe output quality.

**Deliverables**

- Markdown editor mode and preview/edit mode switch.
- Section regeneration endpoint with deterministic validation.
- Full regeneration path that overwrites the current draft and updates timestamps.
- PDF export endpoint that streams the generated file without storing it.
- In-app notifications for export success and failure, plus email notifications for export failures.

**Exit Criteria**

- A user can edit and save Markdown directly.
- Section regeneration rejects blank instructions and updates only the selected section.
- Full regeneration reuses and updates prior settings appropriately.
- PDF export produces a fresh file from the latest saved draft and does not persist the PDF.
- Editing or regeneration after export returns the application to `Needs Action`.

**PRD Acceptance Coverage**

- Edit the resume in plain Markdown mode and save.
- Regenerate a single section with required instructions.
- Regenerate the full resume with updated settings and optional instructions.
- Export the current draft as a PDF download.
- See status return to `Needs Action` after editing or regenerating a previously exported resume.

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
| See status return to `Needs Action` after editing or regenerating a previously exported resume | Phase 4 |
| Toggle the Applied flag independently of the primary status | Phase 1 and Phase 3 |
| Receive in-app notifications for all workflow events | Phase 1, Phase 3, and Phase 4 |
| Receive email notifications for high-signal events | Phase 1, Phase 3, and Phase 4 |
| Manage base resumes (create via file upload or form, edit, delete, set default) | Phase 2 |

## Notes for Future Task Updates

- Update each phase status and this document timestamp as implementation progresses.
- When a task changes schema, rollout order, compatibility, backfills, or post-deploy checks, update `docs/backend-database-migration-runbook.md` in the same task.
- Keep `docs/database_schema.md` and `docs/resume_builder_PRD_v3.md` aligned whenever status models, data contracts, or workflow behavior changes.
