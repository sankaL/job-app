# AI Resume Builder Build Plan

**Document status:** Active roadmap  
**Last updated:** 2026-10-04
**Implementation status:** Phases 0 through 4 implemented; Phase 5 in progress  
**Primary product source:** `docs/resume_builder_PRD_v3.md`  
**Database contract:** `docs/database_schema.md`

This roadmap now includes the committed Phase 0 foundation, the committed Phase 1 application-intake workflow, the committed Phase 1A blocked-site recovery plus Chrome extension intake follow-on, Phase 2 base resumes and profile preferences, Phase 3 generation/validation/assembly, and Phase 4 editing/regeneration/export. Phase 5 hardening and operations work is in progress.


## Generation speed and robustness (Jev audit, parallel writing, keep-original)

**Status:** Complete on branch `generation-speed-robustness`; local verification passed (2026-10-04 15:00 EDT). Awaiting merge and rollout.

- **Changes:**
  - Bounded per-family reasoning with a 16k per-call output limit.
  - Provider routing that denies data retention and sorts by latency, with Gemini pinned to AI Studio.
  - A Jev first-pass claim audit that escalates uncertain claims to Sonnet.
  - Two parallel writer groups, Sonnet repairs and prompt caching.
  - Keep-original sections with a review notice instead of failed generations.
  - Verified sections streaming into the generation preview.
  - A contact-URL false-positive fix.
- **Live result on one real resume:** Medium median 77.6s -> 15.3s; High 33.1s -> 22.9s; cost about $0.12-0.16 -> about $0.06 per generation. All new runs were clean on the first try.
- **Tests:** agents 331, backend 522, local guards OK, frontend build OK. 3 frontend failures are unrelated (2 pre-existing shell tests, 1 timing flake).
- **Rollout:** backend and frontend before the worker.
- **Details:** `docs/task-output/2026-10-04-generation-speed-robustness.md`.
- **Model config (2026-10-04 17:00 EDT):** role-based `shared/model-config.json` (bundled in the backend and agents) replaces the TIER*/JEV_AUDIT_*/classification model environment variables. Copies are enforced by tests.
- **Concurrency (2026-10-04 16:30 EDT):** the worker runs up to 20 jobs at once (was 10), with at most 4 Chromium extraction browsers at a time.
- **Follow-up (2026-10-04 16:00 EDT):** Jev now judges retitled roles, so High no longer always pays a Sonnet audit. Live High runs took 12-17s, down from about 23s; agents tests 335 passed.

## Landing feature card review

**Status:** Complete; reviewed and verified on `generation-speed-robustness` (2026-10-04 12:20 EDT).

Eight CE reviewers reviewed the uncommitted landing card changes. Fixed the arrow color transition so reduced-motion users get an immediate change alongside the image and glow. Nineteen focused auth and card tests, the TypeScript/Vite build and diff checks passed through the Makefile-managed local stack. Browser CSS inspection confirms the reduced-motion rule includes all three elements. Preserved the earlier artwork and 3D component for reversion.

## Unified feature card hover glow

**Status:** Complete; browser verification passed (2026-10-04 12:09 EDT).

Hovering anywhere on a feature card now reveals its full-color image, activates the orange circle/white arrow and adds a soft warm glow behind the whole card. Keyboard focus receives the same state, with immediate changes for reduced motion. Browser inspection confirms only the active card glows and its image and arrow switch together. Updated the PRD; no asset or navigation changes.

## Feature arrow hover contrast

**Status:** Complete; browser verification passed (2026-10-04 12:04 EDT).

Circular feature links now pair the shared brand-orange background with a white arrow on hover and keyboard focus. Browser inspection confirms orange `rgb(255, 89, 65)` and white `rgb(255, 255, 255)` in the active state. No asset or navigation changes.

## Serious tailoring illustration and image hover reveal

**Status:** Complete; local verification passed (2026-10-04 12:01 EDT).

Created a separate ImageGen tailoring illustration without cartoon faces or limbs, preserving the prior assets and saving its prompt. All editorial card images are dark monochrome at rest and return to full color on card hover or keyboard focus; reduced motion disables the filter transition. Production build passes. Browser checks confirm the new asset loads, the resting filter applies to all four images and hovering a card reveals only its image. Updated the PRD.

## Editorial cutout feature cards

**Status:** Complete; local verification passed (2026-10-04 11:55 EDT).

Matched the supplied reference with rounded risograph image frames, curved lower-right cutouts, circular arrow links, category pills and titles/descriptions/tags beneath the images. Removed the landing grid's tilt and overlay treatment while retaining the previous component and both artwork sets for reversion. Preserved the two-column desktop and single-column mobile grid. Arrows open the invite-only access-request route. Updated the PRD. Eighteen focused auth/landing/navigation tests and the production build pass through the Makefile-managed stack. Desktop and mobile checks confirm loaded artwork and no horizontal overflow.

## Feature card header alignment

**Status:** Complete; local verification passed (2026-10-04 11:28 EDT).

Moved the feature icons into the right-hand circular links and raised titles into the same header row. Removed the separate left icon tiles. Preserved both illustration variants and card actions. Production build passes; desktop and 375px mobile checks confirm readable headers without overlap or overflow.

## Light risograph card variant

**Status:** Complete; local verification passed (2026-10-04 11:16 EDT).

Added separate off-white paper variants of all four illustrations with built-in ImageGen and switched the feature cards to dark ink text, pale overlays and subtle control borders. Preserved every original blue WebP asset and its prompts. `FEATURE_CARD_THEME` in LandingPage restores the dark images and treatment with one setting. Production build and the existing card interaction test pass through the local Makefile stack; desktop and mobile checks confirm loaded images, dark headings and no overflow. Updated the PRD. No product behavior changed.

## Risograph 3D feature cards

**Status:** Complete; local verification passed (2026-10-04 11:09 EDT).

Replaced the clay treatment with the supplied layered 3D card component, using the existing Motion dependency. Four locally generated risograph illustrations match the login artwork's texture and palette; WebP encoding reduces their combined size from 12.4 MB to 1.7 MB. Kept feature copy, chip icon, responsive grid and invite-only access actions. Mouse tilt resets on exit; touch and reduced-motion users receive stable cards. Updated the PRD and saved the generation prompts beside the assets. Eighteen focused auth/landing/card tests and the production build pass through the Makefile-managed local stack. Desktop and 375px mobile checks confirm readable cards, loaded local images and no overflow. No schema or AI behavior changed.

## Shared orange CTA accent

**Status:** Complete; local verification passed (2026-10-04 10:12 EDT).

Orange app-shell actions and marketing primary buttons now share the rotating headline's `#ff5941` background and one hover colour through shared brand tokens. Updated the PRD and frontend guidance. Thirty-six focused frontend tests and the TypeScript/Vite production build pass through the Makefile-managed local stack. Browser inspection confirms New Application renders as `rgb(255, 89, 65)`. No schema or AI behavior changed.

## Rotating landing-page headline

**Status:** Complete; local verification passed (2026-10-04 09:59 EDT).

Replaced the hero with "Make it" and the sequence "short", "long", "polished", "work", resting on the final word with the shared animated paper character. Kept the existing hero typography and responsive sizes; the orange marketing Login CTA matches the word background. Added Motion and the reusable `src/components/ui/text-rotate.tsx` component, with timer cleanup, ref navigation, empty-list handling and reduced-motion support. Updated the public-page PRD. Thirty focused frontend tests and the TypeScript/Vite production build pass through the Makefile-managed local stack; desktop and 375px mobile browser checks pass. No schema or AI behavior changed.

Follow-up (2026-10-04 10:01 EDT): the sequence now loops continuously, with two seconds on each word and five seconds on "work". The animated paper character appears inside the orange highlight during "work". A regression test checks two full cycles, the longer pause and character placement. Twenty-two focused frontend tests and the production build pass through the Makefile-managed local stack.

Follow-up (2026-10-04 10:04 EDT): restored the darker orange on marketing primary buttons. The paper character now drops from above into the bright orange highlight when "work" appears, with reduced-motion behavior preserved. Twenty-two focused frontend tests, the production build and local browser verification pass.

Follow-up (2026-10-04 10:07 EDT): changed the hero prefix and accessible heading to "Make my resume". Updated the PRD and landing-page regression assertion. Twenty-two focused frontend tests and the production build pass; desktop and 375px mobile checks confirm the longer text fits.

## Review and commit the full uncommitted snapshot

**Status:** Complete; review fixes and local verification passed (2026-10-04 03:43:51 EDT).

Reviewed all staged work against `HEAD`, preserving intentional spec changes. Confirmed strict keyword-policy gaps, extraction callback/cache ordering, stale recovery overwriting fresh progress, stale deletion leaving queued work alive, and persisted extraction-outcome copy. Clarified smooth catch-up wording and added the missing migration/compatibility note. Final verification: backend 518 passed, agents 296 passed, frontend 287 passed with two failures reproduced on pristine `HEAD`; TypeScript/Vite production build and whitespace checks passed. Actual local Redis CAS coverage passed. All uncommitted changes are included in the requested branch commit. Evidence and exact documentation updates are tracked in [review output](task-output/2026-10-04-uncommitted-code-review.md).

## Extraction fallback window, job abort and prompt hardening

**Status:** Complete; local verification passed (2026-10-04 00:22 EDT): agents (285) and backend (507) suites passed through the Makefile-managed local stack, and the rebuilt local backend venv runs the full backend suite (500 passed, 7 database tests skipped by design). An isolated end-to-end check against real Redis and arq (DB 15, private queue) confirmed that `ExtractionJobQueue.abort` skips a queued job and cancels a running one, freeing its slot in 0.42s.

The extraction model budget is now 45s, with the primary capped at 30s so the fallback always gets at least 15s. Stopping or recovering an extraction cancels the worker job (`allow_abort_jobs`). The `started` callback no longer delays capture. The local backend venv was rebuilt on Python 3.12. The extraction prompt now lets the model decline sign-in walls, closed postings and non-posting pages instead of inventing fields. It also requires a verbatim description, defines `company` as the hiring employer, ignores instructions embedded in page text and no longer exposes `job_keywords`. A known board host overrides the model's origin, and model reference IDs must appear in the source. A test keeps `docs/prompts.md` identical to the code prompt, and `make test-agents` now mounts `docs/prompts.md` for it. The running local agents worker must be restarted to load `allow_abort_jobs`. Updated the PRD, `docs/database_schema.md`, `docs/prompts.md` and `backend/AGENTS.md`. No migration. See the decisions log entry of the same date.

## Bounded job extraction and stalled-extraction recovery

**Status:** Complete; local verification passed (2026-10-04 00:10 EDT): agents (274) and backend (503) suites passed through the Makefile-managed local stack. A real headless-Chromium capture in the agents container finished in 6.1s on a page that never reaches network idle; before the change that page failed as a timeout.

Playwright capture now has one 30s boundary (URL check, 20s navigation, best-effort 5s network-idle settle, single-snapshot text read), and pages that never go idle continue with the loaded DOM. Each extraction job has a 120s arq timeout. The backend fails a started extraction with no progress for 150s, or a queued one not picked up in 300s, as `timed_out`. It checks on detail and progress reads and on every event-stream heartbeat, with one notification per stalled job, and allows deleting stalled rows. Also fixed: Cloudflare and "access denied" false positives in blocked-page detection, reference IDs matched inside words (worker and duplicate detector), superseded jobs clearing newer cached results and paying for model calls after a stop, and unbounded JSON-LD and meta in the prompt. Updated the PRD, `docs/database_schema.md`, `docs/prompts.md` (the job extraction prompt text now matches the code) and `backend/AGENTS.md`. No migration. See the decisions log entry of the same date.

## Processing clock, extraction stop and slow-job notice

**Status:** Complete; local verification passed (2026-10-03 22:57 EDT).

Elapsed time now counts from the job's reported `created_at`, so reloading or navigating mid-job no longer restarts it at 0s. Job extraction gains a Stop extraction button on the processing card that opens the existing confirmation. Full generation, job extraction and inline section regeneration show "This is taking longer than usual" after 90 seconds without a progress update; idle time is the smaller of the server and local readings so a fast client clock cannot raise a false notice. The processing card is now compact (smaller avatar, narrower card, tighter spacing) so more of the resume skeleton shows around it; the paper avatar and its animation are unchanged. Frontend-only; no backend or AI behavior changed. Twelve focused loading tests passed, the application suite passed 128 of 130 with the two known comparison-shell and breakpoint failures, and `tsc --noEmit -p tsconfig.app.json` is clean.

## Eased processing progress bar

**Status:** Complete; local verification passed (2026-10-04 00:25 EDT). 15 focused progress tests pass. The full frontend suite passes 285 of 287; two shell-mode tests in `applications.test.tsx` fail identically without this change, and the production build succeeds.

Job extraction and full generation now show a bar that moves quickly to about 70% in 15 seconds and then slows toward a 94% ceiling, counted from the job's reported start. It never moves backwards, raises its target to higher reported progress and catches up smoothly and reaches 100% only on reported completion. Resume import and section regeneration are unchanged. Added `use-eased-progress.ts` with unit tests and amended the PRD and frontend guidance, which had forbidden simulated progress. See the decisions log entry of the same date.

## Copy-only and decision-only prompts drop the Unslop block

**Status:** Complete; local verification passed (2026-10-04 00:10 EDT): 253 agents and 495 backend tests through the Makefile stack.

Job posting extraction, ATS keyword extraction, resume cleanup, nested entry extraction and the grounding claim audit no longer carry the shared Unslop policy, because they copy source wording or return decisions only. Prose-authoring prompts keep it. Removed the unused backend policy mirror. Updated `agents/worker.py`, `agents/section_generation.py`, `backend/app/services/resume_parser.py`, regression tests, `agents/AGENTS.md`, the PRD and `docs/prompts.md`. See the decisions log entry of the same date.

## High aggressiveness job-fit claim policy

**Status:** Complete; local verification passed (2026-10-04 02:00 EDT).

High now allows plausible job-fit additions (tools, scope, outcomes, metrics) while never inventing employers, dates, tenure, credentials, education or seniority. Updated the writer prompt, aggressiveness-aware grounding audit and repair guidance, the High local numeric check, the legacy High contract and worked example, the UI copy, the PRD, all three AGENTS.md files and `docs/prompts.md`. Low, Medium and keyword optimization are unchanged. Agents (291) and the aggressiveness UI tests passed.

## Generation request budget and failure reporting

**Status:** Complete; local verification passed (2026-10-04 00:30 EDT).

A production generation (`applix-prod`, 2026-10-03 23:33) failed with `RuntimeError` after using all six requests: the first Gemini audit hit its 30s timeout and the Luna fallback took a request, which left no room to audit the final repair. The UI reported "worker_start, LLM attempts: 0" and LangSmith showed the timed-out audit as successful. Changes: writing budgets are now 8 requests (generation, regeneration and keyword optimization), audits time out at 45s, a repair round starts only when its write and audit both fit, and budget exhaustion becomes a section-verification failure that keeps attempt diagnostics and shows a retry message. Failed model runs now get a LangSmith error status with fixed labels, and failed roots record allowlisted reason codes. Agents (260) and backend (495) suites passed through the Makefile-managed local stack.

## LangSmith request settings and opt-in content tracing

**Status:** Complete; local verification passed (2026-10-03 23:20 EDT). Production deployment and content-tracing verification passed (2026-10-03 23:30 EDT).

Model runs now record the request settings actually sent: output mode, output type, temperature, token cap, reasoning mode, reasoning-text exclusion and correction retries. A new `LANGSMITH_TRACE_CONTENT` flag (default off, effective only with tracing on) adds redacted prompt messages and parsed outputs to worker model runs, backend import model runs and Jev attempt runs. Workflow and chain roots, including the cleanup root, stay counts-only. Compose forwards the flag; Makefile test/eval targets force it off. No provider requests, prompts or reasoning defaults changed. Agents (250), backend (492) and local-guard (16) suites passed through the Makefile-managed local stack. Set `LANGSMITH_TRACE_CONTENT=true` on the Railway backend and worker, and in the ignored local env, to enable it.

Code-review follow-up (2026-10-03 23:45 EDT): the cleanup root went back to its placeholder (the child model run carries the body). Building trace output can no longer skip client cleanup or replace a result. The worker now rejects an invalid flag value at startup. Classifier, cleanup-root and parser-wiring tests were added. Stray `tsc -b` output (`frontend/{vite,tailwind}.config.{js,d.ts}`) was removed and gitignored. Agents (252), backend (496), local guards and the frontend build passed.

Production follow-up (2026-10-03 23:30 EDT): deployed committed snapshot `d8bf7fb` through Railway CLI to frontend, backend and agents. GitHub main still pointed to `bfa54bc`, so this release used an archive of the committed snapshot with private env files excluded. Set `LANGSMITH_TRACE_CONTENT=true` on backend and agents; both running configurations confirm effective content capture. Synthetic model-run readback in `applix-prod` confirms prompt/output bodies, contact redaction and credential exclusion. All three deployments, public health and unauthenticated API rejection passed. No new migration is required. See [deployment evidence](task-output/2026-10-03-main-production-verification.md).

## Activity Log outside-click dismissal

**Status:** Complete; local verification passed (2026-10-03 22:43 EDT).

Replaced the fixed-size backdrop button with dismissal on the full-viewport overlay. Clicking outside the Activity Log closes it; inside clicks keep it open. Escape, the close button and focus restoration remain available. Added regression coverage and updated the PRD. All 11 activity-related tests and the TypeScript/Vite build passed through the Makefile-managed local stack. Browser verification confirmed full-page hit coverage, dismissal from the bottom-left corner and focus returning to Activity.

## Merged UI and LangSmith production verification

**Status:** Deployment and migration verification complete (2026-10-03 22:29 EDT). Optional production key replacement awaits a user-supplied private file.

Confirmed frontend, backend and agents successfully deployed merged main `bfa54bc` through the existing GitHub workflow. Applied activity index migration 023 with bounded database timeouts and an atomic ledger insertion. Verified the existing subscription schema effects before reconciling missing historical ledger entries 013–015 without replaying their data updates. All 24 repository migrations are recorded, Basic/Pro allowances remain 10/60 and all 11 protected tables retain forced RLS. Public frontend/backend health and unauthenticated API rejection passed; deployed backend/worker tracing files match main. Both services delivered and read back metadata-only verification traces in `applix-prod` with existing credentials. See [production verification evidence](task-output/2026-10-03-main-production-verification.md).

## Notification inbox layout fix

**Status:** Complete; local verification passed (2026-10-03 19:55 EDT).

Notification rows now use the shared Button adapter's content-sized block layout, allowing wrapped messages to determine row height. Timestamps sit below messages, with status and application actions beneath them. Verified desktop and 390px mobile layouts with no row content overflow. All eight notification regressions and the TypeScript/Vite build passed through the Makefile-managed local stack.

## Shared logo and navigation shell

Shell shape restoration complete (2026-10-03 22:08 EDT). Restored Astryx's elevated shell variant, with gray top/sidebar navigation and a white content area with rounded corners, as requested. Branding, navigation destinations and 2px row gaps remain unchanged. The Makefile-managed TypeScript/Vite build passed.

Profile navigation complete (2026-10-03 22:06 EDT). Added Profile as a standalone destination before Admin for every authenticated user, linking to their existing `/app/profile` page with active-route highlighting. Updated the product contract. Both regular-user and admin navigation regressions passed, the local browser showed the new item, and the Makefile-managed TypeScript/Vite build passed.

Sidebar gap refinement complete (2026-10-03 22:04 EDT). Reduced top-level and nested Admin row gaps, including the gap above the first Admin child, from 8px to 2px to match the user's reference. Row sizing is unchanged. Verified the expanded Admin sidebar in the local browser; the Makefile-managed TypeScript/Vite build passed.

Sidebar highlight separation complete (2026-10-03 22:03 EDT). Replaced ineffective item margin classes with Astryx vertical stacks providing an 8px gap between top-level destinations and between Admin children, plus 8px above the first child. Verified the expanded Admin navigation in the local browser and passed the Makefile-managed TypeScript/Vite build.

Reference spacing follow-up complete (2026-10-03 21:53 EDT). Matched the Astryx App Shell reference with a larger logo beside a smaller semibold brand label, large sidebar rows with an extra spacing step between destinations, and the standard elevated shell's gray navigation background. Verified the local dev preview and passed the Makefile-managed TypeScript/Vite build.

Brand header refinement complete (2026-10-03 21:51 EDT). Removed the "AI Job Applications" subtitle, enlarged "Applix" to match the logo's visual height, tightened their gap, and shifted the brand group 8px left. Verified the applications page in the local browser and passed the Makefile-managed TypeScript/Vite build.

**Status:** Complete; local verification passed (2026-10-03 19:11:49 EDT).

Changed the existing Astryx AppShell to its standard elevated variant and removed separate shell/sidebar background overrides. The logo header and sidebar now share the neutral shell background around the white content area. Verified the desktop dashboard visually, passed three existing mobile-navigation/compare tests, and passed the TypeScript/Vite build through the Makefile-managed local stack.

## Brand assets and crawler metadata

**Status:** Complete; local verification passed (2026-10-03 19:57:39 EDT).

Created a favicon version of the peak mark. It uses a heavier stroke, no hairline gap, and a lighter teal on dark browser tabs. Added `favicon.ico` (16/32/48), `apple-touch-icon.png`, 192/512 PWA icons, a maskable icon and Chrome extension icons (16/32/48/128, now declared in its manifest). Replaced the social preview (`og-image.svg`/`.png`) with the login-style portrait panel and short copy: "Resumes tailored to every job. Grounded in your real experience." Page title, description and Open Graph/Twitter tags now share that copy, with image alt text. Added `robots.txt`, which allows public pages and blocks `/app` and `/api/`, and a sitemap for `/` and `/signup`. Theme color now matches the light canvas. Removed the unused concept logos in `public/logos/`. Auth, signup and extension tests (27) and the production build passed.

## Shared auth layout and new logo rollout

**Status:** Complete; local verification passed (2026-10-03 19:53:47 EDT).

Login, access request and first-time invite setup now share one `AuthPageShell`. A sage illustration panel sits on the left with only the logo. The remote-work portrait sits on the panel and its plant spills slightly past the panel edge. The right side shows a large heading, all errors and statuses under it, a divider and the form. Login is simplified to "Sign in", with email/password in production or the account dropdown in local dev, plus a "Request access" link. Local-user load failures, with Retry, and sign-in errors show under the heading. All three pages use the shared Astryx form controls. The removed `AuthBrand`, login-only controls and the businessman illustration were deleted. The new peak mark is now the single `applix-logo.svg` and also replaces the favicon, the Chrome extension SVG/PNG, and the social preview image (reversed for the dark background). TypeScript and the production build passed, and 27 auth/signup/extension tests passed. The full run failed only `base-resume-workbench`, which cannot load without `VITE_API_URL`, and the compare immersive-mode test in concurrently edited app-shell files. Browser checks covered 1440/1100/1024/390px login, request access, invite setup and the dev-mode error state.

## Public landing and login typography

**Status:** Complete; local verification passed (2026-10-03 19:08:04 EDT).

The user rejected the full Mainline-template redesign, so the landing and login pages were restored to their original layout, colors, copy and illustration. Only typography changed. Text uses Inter. Headings use DM Sans semibold with tight tracking and its alternate glyph sets, scoped to `.public-design`. The hero heading cap dropped from 84px to 80px, and plan prices use medium weight. Signup and authenticated pages are unchanged. TypeScript passed, as did all 17 auth tests, unchanged from before. Browser checks at 1440px and 390px showed no horizontal overflow.

Logo and beige follow-up complete (2026-10-03 19:18:02 EDT). Added a new mark (`public/applix-mark.svg`) for the landing page and the shared login/signup brand pill. From four options, the user chose a rounded peak A with no check mark. It is drawn as one uniform 12-unit stroke, so the base matches the sides. The sides use a dark-teal gradient and the base is orange, separated by a hairline gap. The app top bar, favicon and Chrome extension keep the previous logo. Lightened the public canvas from `#f5f3ee` to `#f9f8f6`. The login/signup gradient now uses a soft warm off-white instead of sand, and the ember/amber glows were reduced. TypeScript passed, as did 23 auth and signup tests. Before/after screenshots were compared at 1440px.

## Application workspace controls and generation loading

Centered loading feedback complete (2026-10-03 22:46 EDT). Replaced the full-generation step list with one centered ProgressBar, reported status, rotating explanations and a small SVG paper avatar over a resume skeleton. Job extraction and resume import share the treatment; extraction no longer simulates advancing percentages, and import stays indeterminate. The application details and app shell are unchanged. Nineteen focused loading/import/section regressions and the Makefile TypeScript/Vite build passed; the broader application run passed 144 of 146 tests, with failures in comparison-shell and breakpoint edit-preservation checks. Browser previews verified generation and extraction at desktop and narrow widths with no horizontal overflow. AI orchestration is unchanged.

Resume rename placement complete (2026-10-03 21:19 EDT). Moved the standalone ghost pencil from the app-shell action group to beside the resume title, preserving keyboard rename/save/cancel behavior. Updated regression coverage and product guidance. All 26 focused tests and TypeScript/Vite build passed.

Compact application details complete (2026-10-03 21:17 EDT). Removed the workbench heading and preview instructions; generation/export metadata and revision now sit beside the company. The warmer details panel aligns with the title and presents values read-only with per-field editing, expandable long text, conditional Save actions, and preserved Notes autosave. Replaced aggressiveness radio descriptions with an Astryx three-stop slider and hover/focus/touch help, retaining the High warning. Production build passed. Affected suite: 187 passed, 1 known pre-existing immersive comparison-mode failure. Browser verified layout, field-specific edits, settings and collapse/expand. See [implementation notes](task-output/2026-10-03-compact-application-details.md).

App-shell action placement complete (2026-10-03 20:15 EDT). All page actions now render in the app shell top bar directly beside notifications. Preserved connected groups, single buttons, and orange primary CTAs with white text. Removed floating action layout and bottom clearance. Portal regression coverage verifies navigation cleanup; 26 focused tests and TypeScript/Vite build passed. Visually confirmed dashboard and resume-library actions in the shell.

Resume editor header and exclusion styling complete (2026-10-03 20:09 EDT). Moved the base resume editor action group into its page header, with form-associated save and rename preserved. Excluded sections have a faint red background and red status text. Updated product guidance; 54 focused tests and TypeScript/Vite build passed. Visually verified in the local editor.

Resume review sidebar cleanup complete (2026-10-03 20:05 EDT). Reviewed section dots turn green, section labels truncate on one line with full-name tooltips, and review progress sits at the bottom of the desktop sidebar. Removed redundant sidebar guidance and the base resume save-status footer; retained floating save feedback and error recovery. Updated PRD and regression coverage. All 54 focused tests and TypeScript/Vite build passed; visually checked the local editor.


Floating CTA color refinement complete (2026-10-03 20:01 EDT). Scoped brand-orange backgrounds and white text to primary buttons within floating page-action bars, with a darker orange hover state. Secondary floating buttons and all non-floating buttons retain their existing colors. Updated PRD and frontend guidance. TypeScript/Vite build passed.

Grouped primary actions complete (2026-10-03 19:58 EDT). Each connected action group now designates one black primary CTA, with secondary styling for its other actions. Save/continue actions default to the final position; recovery, edit and application controls explicitly select their main action. Icon buttons and the application dropdown follow the same hierarchy, and loading/disabled states do not promote another action. Updated PRD and frontend guidance. All 63 focused shared-control, workbench and table tests passed; TypeScript/Vite build passed.

Shared action-button styling complete (2026-10-03 19:54 EDT). Related actions now use Astryx ButtonGroup through a shared ActionButtons adapter; single actions remain Astryx Buttons. Standardized resume library/editor, application and admin row actions, page bars, dialogs, recovery actions, draft editing and table view/pagination controls. Groups share native sizing and secondary styling, with destructive intent retained. Removed custom floating pill/shadow and workbench sizing overrides; sign-in uses the same Button adapter. Added regression coverage for fragment handling, single actions, mixed icon/text sizes, arrow-key navigation, disabled-action skipping and external form submission. All 261 passing frontend tests include the new coverage; one previously observed comparison-shell test still fails. TypeScript/Vite build passed. Browser checks verified both marked resume screens, group keyboard focus and 390px layout without horizontal overflow. Mobile save-status text clears the floating action group. Updated PRD and frontend guidance.

Application details panel refinement complete (2026-10-03 19:32 EDT). Added consistent section headings, spacing and dividers, plus an expanded-by-default panel header and keyboard-accessible collapse control. Collapsing preserves mounted forms and unsaved values, frees resume width and leaves a light orange rail at the right edge. Each application starts expanded. Browser checks at 2023px and 390px showed no horizontal overflow; the collapsed rail was 48px wide and its expand control stayed visible while scrolling. Keyboard reopening passed. Updated PRD. The new preservation/focus regression and 123 other application tests passed; the comparison immersive-shell test failed and remains outside this panel change. TypeScript/Vite build passed.

Activity Log row refinement complete (2026-10-03 19:19 EDT). Standardized every event into title/time, description, and status/Details rows, with a subtle separator beneath each event. Expandable rows use the shared Button block-content layout and compensate for hover padding so all timestamps share the same right edge. Added keyboard expand/collapse coverage; nine activity-related tests and the TypeScript/Vite build passed. Verified the layout against the local City of Toronto application. Updated the PRD; event data and AI behavior are unchanged.

Section regeneration refinement complete (2026-10-03 19:12:01 EDT). Section/role regeneration now keeps the workbench mounted and replaces only the selected content with unframed skeleton lines, a slim progress bar, reported messages and cancellation. Tabs, sibling roles and support panels remain available; a reconnect without a known target shows compact feedback within the workbench. Removed obsolete floating-action height reservation on application detail, leaving a 15px desktop bottom inset in the browser check. The activity connector measures the first/last dot centers and updates on expansion and resize; both endpoint offsets measured zero before and after expansion. Passed 43 workbench/loading regressions, three targeted application/activity regressions and the TypeScript/Vite production build. Updated PRD; AI behavior is unchanged.

**Status:** Complete; local verification passed (2026-10-03 18:53:35 EDT).

Moved application actions beside the title using Astryx ButtonGroup, grouped section editing/inclusion/order controls, removed draft section guidance and duplicate comparison actions, and aligned comparison section navigation with display controls. Added a faint orange details background and thin orange scrollbar. Generation now pairs an animated Astryx resume/section Skeleton with Astryx ProgressBar, reported job messages, elapsed time and cancellation; existing drafts remain locked and available during regeneration. Progress remains indeterminate until reported by the server. Updated the PRD and scoped frontend guidance. The full frontend run passed 255 of 256 tests; after updating the removed comparison action expectation, all 174 affected tests passed. TypeScript/Vite build passed. Browser checks covered header/section button grouping, arrow-key focus, the warm details panel, and comparison controls at 2033px and 390px with no horizontal overflow. Loading previews covered the full resume and a section in a 390px frame. No AI orchestration or prompt behavior changed.

## Dashboard activity ranges and admin metrics redesign

**Status:** Complete; local verification passed (2026-10-03 17:57:42 EDT).

Replaced Monthly Activity with a range-filtered Activity chart: 7 days, 30 days and 3 months show daily bars, and 1 year shows 52 weekly bars. Data comes from the new owner-scoped `GET /api/applications/creation-activity`, which aggregates one bounded, timezone-aware window in Postgres, backed by migration 023's `(user_id, created_at DESC)` index. Bars stack "marked applied" under "not yet applied". Follow-up: job sources and the admin user/invite breakdowns use donuts, status breakdown uses badge figures, and top companies use an avatar list. Bars remain for the time series and workflow outcomes; the summary figures above the chart were removed at the user's request. Passed 21 new backend tests (including local Postgres aggregation and user isolation), the full backend suite (470), all frontend tests (255 at the final run) and the production build. Headless-browser screenshots covered desktop and 400px layouts with no horizontal overflow. See [implementation notes](task-output/2026-10-03-dashboard-activity-ranges.md).

## LangSmith coverage and environment projects

**Status:** Complete; local and production ingestion plus native model/token reporting verified (2026-10-03 19:22:53 EDT).

Enabled normal local tracing under `applix-dev`; production retains `applix-prod`. Added Jev classification attempt traces, shared import traces for cleanup/nested extraction, fallback metadata, and live evaluation case tags/settings. Error traces retain exception types without raw provider bodies or tracebacks. Offline checks remain untraced. Initial verification passed 91 backend, 163 worker/evaluation and 15 environment-guard tests. Follow-up verification passed 93 backend, 46 worker/evaluation and 15 environment-guard tests. Bounded fictional provider calls produced six confirmed backend/worker traces in each environment, with private test input and credentials absent from the stored runs. Production health remains 200 and unauthenticated application access remains 401. See [implementation and release evidence](task-output/2026-10-03-langsmith-all-llm-tasks.md).

Workspace routing follow-up (2026-10-03 18:25:04 EDT): the HTTP 403 came from missing workspace routing for valid organization-scoped keys. Added `LANGSMITH_WORKSPACE_ID` to both ignored local env files, Compose, backend/worker settings, cached clients and live evaluation env-file settings. Both env files retain permissions `0600`; the user's key was not printed or committed. Added `make dev-runtime` to refresh the source-mounted backend/worker without reassigning ports. Set the same workspace selector in Railway and redeployed the existing isolated releases without uploading unrelated changes. Trace delivery is now verified locally and in production.

Native LLM display follow-up (2026-10-03 19:22:53 EDT): the user's real section-regeneration trace contained model/usage only as generic fields, leaving LangSmith's native token counters at zero. Shared helpers now add `ls_provider`, `ls_model_name`, `ls_model_type` and recognized `usage_metadata` for available counts. Unknown usage stays omitted. Model identity and native counters were read back from six new fictional traces in each environment; stored privacy checks passed. Passed 44 backend, 52 worker/evaluation and 15 environment-guard checks. Refreshed local services and deployed only the two tracing helpers over the isolated production snapshot; remote hashes match and health/auth checks passed. The existing counts-only content policy remains in force, and historical runs are not rewritten.


## Astryx shared app design system

Dashboard panel order complete (2026-10-03 18:55:25 EDT). Reordered the analytics row to Job sources, Top companies, Status breakdown, placing companies in the middle and status on the right. Verified the desktop dashboard in the local browser; TypeScript/Vite build passed.

Status badge text centering complete (2026-10-03 18:27:53 EDT). Centered labels within the shared status pills, including the fixed-width Recent activity badges.

Dashboard recent-activity alignment complete (2026-10-03 18:24:11 EDT). Moved each status badge to the right edge of its row, with the application title and company on the left.

Profile width follow-up complete (2026-10-03 18:19:42 EDT). Removed the secondary profile section rail and mobile tabs at the user’s request, and removed the template’s maximum-width cap so description/form sections use the full available app width. Preserved section spacing, narrow stacking, native form submission and save recovery. Five focused profile regressions and the production build passed. Fixture browser checks covered 1909, 1440, 900, 390 and 320px with no horizontal overflow; the 1909px viewport uses a 1572px settings region and Enter submission succeeds.

Resume library width follow-up complete (2026-10-03 18:18:12 EDT). Removed the collection width cap and expanded search to fill the available page width; the responsive card grid and empty states use the full content region. Browser verification and the production build passed.

Profile settings-template follow-up complete (2026-10-03 18:16:52 EDT). Adapted the requested Astryx CLI settings template into `/app/profile` with its 1440px frame, 260px desktop section rail, description/form columns, native labeled fields and mobile section tabs with stacked fields. Section navigation scrolls and focuses headings without losing edits. Floating Save now submits the associated form, with unsaved/saved feedback and recoverable save errors. Passed all five focused profile regressions and the TypeScript/Vite production build through the Makefile-managed local stack. Fixture browser checks passed at 1440, 1100, 900, 768, 390 and 320px, including navigation focus, unsaved edits, Enter submission and no horizontal overflow.

Resume card footer alignment complete (2026-10-03 18:13:59 EDT). Edit/Delete actions now share the Updated/Created row, vertically centered and right-aligned. Verified visually in the local browser; the build check was blocked by unrelated missing imports in the concurrent settings template scaffold.

Resume card refinement complete (2026-10-03 18:09:20 EDT). Added custom SVG paper artwork, a saved Summary excerpt, stronger title/default hierarchy, plain date labels and right-aligned icon-only Edit/Delete actions. The additive summary response reads current document content with legacy Markdown fallback and a 240-character limit; no AI call or schema migration. Passed 24 backend tests (including local Postgres owner isolation/current-summary checks), six frontend regressions and the production build. Desktop and narrow browser checks passed.

Resume library documentation-template follow-up complete (2026-10-03 18:04:17 EDT). Adapted the Astryx CLI documentation template into a responsive clickable card grid with persistent search, default/date metadata, Edit, Delete and Set Default controls. Card and keyboard activation open the resume workbench through React Router; nested actions retain their own behavior. Six focused regression tests and the TypeScript/Vite production build passed through the Makefile-managed local Docker stack. Browser checks covered desktop/narrow layout, search recovery and card navigation.

Status grouping follow-up complete (2026-10-03 17:54:59 EDT). Applications now open grouped by status, retaining newest-updated sorting within groups and company/base-resume grouping in View options. Updated the product contract and existing design decision. Both targeted regressions passed, covering default status groups, multi-status filtering and current-page selection.

Table-filter redesign completed and locally verified (2026-10-03 17:53:37 EDT). Used the Astryx CLI table-filter scaffold to replace the shared table renderer with native Astryx rows and grouping. Applications and admin users now share compact filter chips, sorting, collapsible groups, column/density controls, page-session saved views and borderless action icons. Applied is an icon toggle; existing selection and mutation safeguards remain. Browser checked desktop, narrow layout, status/tier filters, grouping and saved views. The final production build passed; the full frontend run passed 247 of 248 tests, and the single concurrently changed dashboard test passed on rerun. See [verification details](task-output/2026-10-03-astryx-table-filter.md).

Local login dropdown completed and reviewed (2026-10-03 17:49 EDT). Local dev login selects an existing active account through the shared DropdownMenu, with password entry removed locally. The user-list endpoint exposes emails only, disables caching and returns 404 outside dev mode. Added loading, empty/error/retry handling, a 10-second timeout and abort cleanup. Passed 17 frontend auth tests, 32 backend auth/config tests and the TypeScript/Vite production build through the Makefile-managed stack. Browser verified local options and password-free sign-in. Production login and fixture API behavior are preserved.

Neutral color restoration completed and reviewed (2026-10-03 17:11 EDT). Restored Astryx neutral in the app shell and floating action portals, removed the custom orange theme/assets and secondary CTA color override, and retained floating placement, dropdowns, bar charts and compact spacing. Browser verified neutral dashboard accents, black primary CTAs and neutral secondary actions. All 239 frontend tests and the TypeScript/Vite production build passed.

Header spacing follow-up completed and reviewed (2026-10-03 17:09:08 EDT). Pages with removed body headings share a 12px top inset, reduced from 32px on desktop and 20px on narrow screens. Fitted workbench heights use the same inset. Browser checks covered dashboard, application/resume lists, source editor, profile, extension and admin; individual application headings retain their existing spacing. The narrow dashboard had no horizontal overflow, and the TypeScript/Vite production build passed.

Bar chart, dropdown and CTA follow-up completed and reviewed (2026-10-03 17:05:00 EDT). Monthly Activity uses grouped bars in expanded/compact views. Shared selection controls and account/application action menus use Astryx DropdownMenu. The CLI-built Applix theme extends neutral with the logo orange and readable dark CTA lettering. Review preserved native field validation/form data/refs, disabled choices, reset, keyboard selection and focus restoration; fixed legend consistency, notification/code contrast and workbench control alignment. All 239 frontend tests and the TypeScript/Vite production build passed. Browser verified filtering, year/account menus, upward application actions, narrow menu bounds and CTA color. See [implementation evidence](task-output/2026-10-03-astryx-template-redesign.md).

Floating page actions follow-up completed and reviewed (2026-10-03 16:54:00 EDT). Removed duplicate visible body page titles/introductions across authenticated routes, retaining accessible headings and the full job title/company on individual applications. Page actions share a bottom-right floating group, including source save/name/upload and extension connection controls. Review preserved native form submission, Enter/Escape naming behavior, content clearance, notification placement and upward-opening application menus; removed superseded action/save-button styles. All 238 frontend tests and the TypeScript/Vite production build passed. Browser checks covered dashboard navigation, application titles/menus, source naming, resume upload, grouped actions and mobile drawer behavior. See [follow-up verification](task-output/2026-10-03-astryx-template-redesign.md).

**Status:** Complete; self-review fixes and local verification passed (2026-10-03 14:23:38 EDT).

Converted authenticated and admin routes to Astryx core 0.6.5 and its neutral theme, preserving existing screens, placements and responsive layout. Shared buttons, table rows, cards, status tokens, form controls and menu frames replace scattered control styles. Marketing and login retain isolated public styling. Removed unreachable UI helpers, unused imports/exports, superseded styles and unused dependencies; TypeScript now rejects unused locals and parameters.

Self-review fixed disabled/loading controls, table column widths, keyboard sorting/navigation, menu Escape dismissal, pending-dialog dismissal, Markdown contrast and toast timer cleanup. Passed 235 frontend tests, the TypeScript/Vite production build, 15 local environment guard tests and 11 Astryx doctor checks. Production dependency audit reports zero advisories. Browser verified app screens, menus, source editing and mobile filters; admin pages were also inspected with existing local permissions, while write operations remain covered by regression mocks. See [implementation and review evidence](task-output/2026-10-03-astryx-design-system.md).

Card reduction follow-up completed and reviewed (2026-10-03 16:11:48 EDT). Replaced page, form, metric, list and comparison card frames with shared transparent Astryx sections and dividers. Tables and skeletons use the same flat treatment. Kept the resume paper and the Judge/ATS review widgets distinct, with existing placements and controls. Removed unused card variants. The full frontend run passed 234 of 235 tests; updated the comparison tooltip assertion and all five comparison tests passed on rerun. The final production build passed. Browser verified dashboard, tables, workbench, profile and a narrow profile layout without horizontal overflow.

Template redesign follow-up completed and reviewed (2026-10-03 16:35:00 EDT). Adapted the official Shell Nav, Searchable Table, Analytics Dashboard, Settings Form and Page Editor patterns. The shared Astryx shell/navigation, semantic typography, title-first table columns, resume rows and capped profile settings replace the earlier placement restriction. Removed remaining Judge/ATS card frames, metric icon tiles, floating save-bar decoration, old shell/sidebar code and temporary template scaffolds. Review fixed mobile drawer integration, admin icon overlap, keyboard access to recent activity and chart interpolation. All 236 frontend tests and the TypeScript/Vite production build passed. Browser checks verified desktop app/admin screens and mobile drawer dismissal, route selection and focus restoration. See [template redesign and verification](task-output/2026-10-03-astryx-template-redesign.md).

## Main merge and Railway release preparation

**Status:** Complete; all three production deployments and health checks passed (2026-09-30 23:56:35 EDT).

Merged main into v1.2 without conflicts and verified 913 local tests plus the frontend production build. The user authorized production rollout through the CLI. Backed up labels, applied and atomically recorded migrations 019–022, verified the new schema/index and 10/60 request allowances, and configured explicit operation models plus Jev import settings without early deploys. Production had zero queued or active jobs before rollout. See [release evidence](task-output/2026-09-30-main-railway-release.md).

## Section resume reliability upgrade

**Status:** Complete; independent review findings fixed and local verification passed (2026-09-30 16:30:39 EDT).

- Versioned base/draft documents, stable nested IDs, import review and local contact suggestions.
- Pydantic AI provider calls, shared bounded budgets, immutable factual assembly and targeted repairs.
- Source snapshots for section/keyword regeneration and comparison; one inline workbench with custom sections and role actions.
- Additive migrations 019/020; local Makefile regression targets; initial checks used no live provider requests or hosted test services.

### Provider and browser verification follow-up

**Status:** Complete (2026-09-30 17:44:02 EDT).

The browser walkthrough verified source review, custom sections, saved edits, fixed Education controls, role instructions and snapshot-based comparison. PDF and DOCX byte checks verified the latest content. Final suites passed 383 backend, 224 worker, 199 frontend and 15 environment/cleanup tests; the frontend production build passed. Synthetic live checks exposed incomplete nested schemas and Google transport constraints. Complete nested contracts plus scoped transport profiles resolved the sample's failures: all four fresh generation/regeneration cases passed across ten HTTP 200 requests, with one targeted repair and $0.03746250 provider-reported cost. Import calls use the same Google subset, verified by mocks. Test tooling guards local endpoints, worker state, atomic fixture inserts and absolute cleanup deadlines. Larger quality/reliability samples, live import/Jev evaluation and browser Blob delivery remain unmeasured; see the [verification report](task-output/2026-09-30-section-generation-evaluation-plan.md).

### Local runtime model audit

**Status:** Complete (2026-09-30 19:11:45 EDT).

Confirmed local import classification uses rules, with Jev opt-in; AI cleanup/nested extraction uses GPT 5.6 Luna. Local Basic generation uses Gemini 3 Flash Preview with GPT 5.4 Mini fallback; Pro uses GPT 5.4 Mini with Gemini 3 Flash Preview fallback. Tier reservations override worker environment defaults, including regeneration and role actions. The standalone live evaluator does not apply these tier overrides. Restored the API from isolated browser-test credentials to its configured local development credentials and verified service health. The generation worker remains stopped; no queued AI work was dispatched. Ambiguous Experience imports can still retain Markdown instead of job entries.

### Local background processing restored

**Status:** Complete (2026-09-30 19:37:47 EDT).

Verified the local API uses configured credentials, checked the empty ARQ queue, and restored the local Compose generation worker. Worker credentials and Redis heartbeat passed checks; Makefile health checks passed for the API and frontend. No queued AI jobs were dispatched. Existing flat resumes remain unchanged. The proposed operation-based model routing and subscription quota changes have not been implemented.

## Operation-based models and request allowances

**Status:** Complete; code review fixes and local checks passed (2026-09-30 20:09:01 EDT).

Implemented two shared model pairs with default reasoning: Tier 1 Sonnet 5.5 → GPT 6.1 Sol for initial/full writing, Tier 2 Gemini 3.8 Flash → GPT 6 Luna for other generative tasks, audits and repairs. Jev classification defaults on with local parsing fallback. Basic/Pro now govern request allowances only (10/60); admin model selectors, standalone import cleanup and automatic quality scoring are removed. Fixed legacy repair routing, keyword-failure refunds, informed targeted repair/final fallback and admin refresh state. Migration 021 applied locally; API/worker configuration and service health verified. Passed 391 backend, 223 worker, 197 frontend and 15 environment tests plus production build. All four model protocol probes and Jev fictional labels passed. Workflow samples passed full-low, role and keyword cases; an initial aggressive case failed closed, followed by a fresh pass after recovery changes. These samples do not establish a reliability rate. See [implementation and review evidence](task-output/2026-09-30-operation-model-routing.md).

## Follow-up: section preferences in the resume workbench

**Status:** Complete; implementation and local review checks passed (2026-09-30 20:53:36 EDT). Combined review and verification passed; included in the coordinating commit (2026-09-30 21:17 EDT).

- Move section inclusion and ordering from Profile into the base resume workbench, including custom sections. Keep personal information and general writing preferences on Profile.
- Make the reviewed base resume document the source of truth for initial generation structure; remove conflicting profile toggles. Allow generated resumes to retain their own section inclusion and order for editing and regeneration.
- Define compatibility handling for existing profile preferences and draft snapshots before rollout. Add regression coverage for inclusion, ordering, custom sections and regeneration, and update the relevant product, prompt and migration documentation during implementation.

Initial writing follows the reviewed base document, including custom sections. Saved drafts keep their inclusion/order and frozen source links during regeneration. An explicit latest-base reset adopts new facts or legacy drafts. Local review fixed role restoration, canonical worker operation propagation, re-included source comparison and document-authoritative export. Deprecated Profile JSON and old snapshots remain stored without backfill or a new migration. Verification passed 402 backend, 231 worker, 200 frontend and 15 guard tests, plus the final 29 workbench/comparison tests and production build. Parallel workbench/import changes are preserved for combined review. See [implementation evidence](task-output/2026-09-30-resume-section-preferences.md).

### Implementation plan

1. Remove Profile section controls and make initial structured generation follow the reviewed base document, including custom sections.
2. Use saved draft inclusion/order and frozen sources for regeneration. Preserve fixed/manual or structurally edited sections; add an explicit latest-base reset for source refresh and legacy recovery.
3. Keep deprecated Profile JSON and old documents/snapshots intact. Synchronize draft snapshot projections under owner/revision fences; verify comparison and export projections.
4. Add regression coverage, run the Makefile local Docker suites/build, review the diff and update product/prompt/schema/rollout documentation.

## Base resume review and job-boundary repair

**Status:** Complete; preview-by-default follow-up, 210 frontend tests, production build, static responsive verification and review fixes passed (2026-09-30 21:17 EDT). Combined review and verification passed; included in the coordinating commit (2026-09-30 21:17 EDT).

- Replace nested section/entry cards with a document workbench, section-focused source navigation, collapsible roles, secondary settings, review progress and a floating save dock. Both base and application workbenches open in preview; Edit or double-click opens just one section and retains unsaved content.
- Separate adjacent jobs without relying on PDF blank lines. Preserve ambiguous source text and allow bounded nested extraction for suspicious partial parses. Reject merged/reordered dated-entry output; retain explicit review gates and source grounding.
- Preserve the concurrent resume-owned inclusion/order work. No service restart, production test flow, push or deploy is part of this task.

## Combined workbench completion review

**Status:** Complete; reviewed, valid findings fixed, and included in the branch commit (2026-09-30 21:17 EDT).

Both tasks and the preview follow-up finished before commit. Combined validation passed 418 backend, 231 worker, 210 frontend and 15 environment tests (874 total), plus the frontend type check/production build and whitespace checks. Review fixes cover job boundaries/date order, frozen-source regeneration and role preservation, document-authoritative exports, comparison of re-included sections, floating-save form association and suppression of external Markdown images. Static synthetic layouts passed five widths from 320 to 1440 pixels. Live-origin/browser and actual failing PDF verification remain unperformed; existing merged imports require re-upload or manual correction. See [combined review evidence](task-output/2026-09-30-combined-workbench-review.md).

## Resume workbench tabs, scrolling and names

**Status:** Complete; review findings fixed and local verification passed (2026-09-30 21:43:32 EDT).

Source and generated workbenches use contact-first real tabs, ordered sections and a distinct extracted-text reference. The source workspace uses the full width beneath its name/banners, with saved-name breadcrumbs. Removed nested workbench/shell scrolling, height matching and the fixed-save bottom reserve; growing text editors share page scrolling. Migration 022 enforces names unique per user with collision-safe duplicate-label suffixes and sanitized conflicts. Passed 214 frontend and 421 backend tests, final 42 tab/editor tests, the production build and browser checks. See [implementation and review evidence](task-output/2026-09-30-workbench-tabs.md).

## Sticky workbench navigation and header name editing

**Status:** Complete; review fixes and local verification passed (2026-09-30 22:20:23 EDT).

Resume names edit inline in the header. Desktop source and application workbenches keep tabs and save controls in place while selected content scrolls. Application resumes appear on the left, with Judge, ATS, job description, settings and notes in a separate right scroll area. Narrow and short screens retain accessible page flow. Review fixed duplicate name fields on re-upload, supporting-card overflow extending the page, and progress/empty-state sizing. Passed 218 frontend tests, production build and browser scroll/responsive checks. See [implementation and review evidence](task-output/2026-09-30-sticky-workbenches.md).

## Tier 2 base resume role extraction repair

**Status:** Complete; self-review findings fixed, reported local import repaired and browser-verified, local stack refreshed with existing ports, and validation passed (2026-09-30 22:57:20 EDT).

Default Tier 2 extraction now receives numbered source lines and returns explicit employment/education facts plus role and duty spans. Duty text is copied locally, preserving PDF wraps and metrics without model transcription. Per-entry validation rejects merged/reordered roles, wrong-role facts, merged duty bullets, gaps and overlaps. Optional dates/locations remain blank when absent; education accepts a single graduation year. Source text and mandatory review remain intact. No SQL migration or bulk backfill.

The reported upload contained three roles at the same employer plus an internship. The final span-based primary Tier 2 call completed in 11.60s, and total import took 11.89s. Saved only this unreviewed local import with an owner/revision fence as revision 2; browser confirmed four separate roles and preserved duties. Full suites passed 438 backend, 231 worker and 218 frontend tests, plus type check/production build. Final focused import/upload/document checks passed 101 tests after two more review regressions. Makefile health checks passed at the original API/frontend ports. See [implementation and review evidence](task-output/2026-09-30-base-resume-role-extraction.md).

## Full-width upload and resume processing feedback

**Status:** Complete; code-review findings fixed and local checks passed (2026-09-30 23:14:17 EDT).

The upload page now fills the resume workspace, introducing the section review layout before import. Import and generation share a readable processing panel with meaningful task descriptions, elapsed time and accessible status messages. Generation uses reported server progress; import remains indeterminate. Full regeneration retains the current draft as read-only below processing feedback. Local Makefile checks passed all 223 frontend tests and the production build. See [implementation and review evidence](task-output/2026-09-30-resume-processing-ui.md).

## Contact section and upload cleanup

**Status:** Complete; self-review and local verification passed (2026-09-30 23:21:15 EDT).

Source and application contact panels now share normal section headings, preview text and header actions. Upload is a full-width form with one PDF drop zone/picker, name and AI checkbox. Removed the preview column, repeated heading and cards, including the import progress container. Invalid or multiple drops preserve the selected PDF; busy imports ignore replacement drops and failures retain the file/name for retry. Passed 227 frontend tests and the TypeScript/Vite build, with browser verification of the upload layout and source contact section. No schema or AI behavior changed.

## Planning Defaults

- Build the MVP as a private, invite-only product with authenticated access only.
- Keep all user data explicitly scoped by `user_id` and protected by backend ownership checks.
- Store versioned section documents with Markdown content and deterministic export projections.
- Keep `applied` separate from the primary application status.
- Treat `docs/database_schema.md` as the schema source of truth.
- Local development and testing must run through a Dockerized, Makefile-managed stack.
- Dev mode must use the Makefile-managed local stack with repo-owned auth and local Postgres services.
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
| Phase 4 | Implemented | Editing, regeneration, and PDF/DOCX export |
| Phase 5 | In Progress | Invite onboarding and admin operations shipped; hardening, recovery, and end-to-end MVP acceptance remaining |

## Task Tracking

These tables track implementation-sized tasks seeded from the phase roadmap below. The phase sections remain the planning source of truth.

### Phase 0 Tasks

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| B5-T83 | Set GPT 5.6 Luna as primary for Output Validation with Gemini 3.7 Flash fallback | AI/BE/Infra/Docs | DONE | 2026-08-23 14:05:00 EDT | Configured `VALIDATION_AGENT_MODEL` to use `openai/gpt-5.6-luna` as primary with `google/gemini-3.7-flash` fallback across Railway production and local compose/environment configurations, and passed full regression test suites. |
| B5-T82 | Set GPT 5.6 Luna as primary for Extraction, Keyword Extraction, and Resume Cleanup with Gemini 3.7 Flash fallback | AI/BE/Infra/Docs | DONE | 2026-08-23 14:03:00 EDT | Configured `EXTRACTION_AGENT_MODEL`, `KEYWORD_EXTRACTION_AGENT_MODEL`, and `OPENROUTER_CLEANUP_MODEL` to use `openai/gpt-5.6-luna` as primary with `google/gemini-3.7-flash` fallback across Railway production and local environments while retaining `google/gemini-3.7-flash` as primary for Generation and Judge workflows. |
| B5-T81 | Set Gemini 3.7 Flash as primary model with GPT 5.6 Luna fallback across Railway production and local environments | AI/BE/Infra/Docs | DONE | 2026-08-23 13:47:00 EDT | Swapped model order across Railway production environment variables (`agents`, `backend`) and local compose/environment configurations to use `google/gemini-3.7-flash` as primary and `openai/gpt-5.6-luna` as fallback with auto reasoning, and passed full regression test suites. |
| B5-T80 | Apply code-review hardening to tracing, model defaults, and resume comparison | AI/BE/FE/Infra/Docs | DONE | 2026-08-22 22:16:09 EDT | Made LangSmith telemetry completion best-effort so observability failures cannot fail resume workflows, sanitized profile URLs before tracing, synchronized Compose and PRD model defaults with the committed Luna/Gemini configuration, and made employer, location, and date changes visible in the compare workspace. Added focused regression coverage. |
| B5-T79 | Redesign compare UI into an interactive section-by-section comparison workspace with GSAP motion and word diffing | FE/Docs | DONE | 2026-08-23 22:10:00 EDT | Replaced dual full-document side-by-side scrolling columns with a unified section-by-section compare workspace, added canonical resume section parsing and pairing, job-by-job experience matching with title reframing badges, inline word-level diffing with semantic spruce/ember highlighting, GSAP entrance and sliding tab indicators, unified vs side-by-side view toggles, in-place edit mode, and then hardened the compare engine so removed education entries and omitted skills still appear accurately in matched sections. |
| B5-T78 | Add opt-in LangSmith tracing and the shared Unslop prompt policy to every LLM capability | AI/BE/Infra/Docs | DONE | 2026-08-22 20:59:22 EDT | Added sanitized workflow and model-attempt traces across worker agents and backend resume cleanup, kept local tracing disabled by default, required project and API-key configuration when enabled, embedded the exact shared Unslop instruction with operation-rule precedence in every system prompt, and passed 154 agent tests, 305 backend tests, syntax checks, diff checks, and Compose validation. Production trace ingestion remains off until Railway receives valid LangSmith credentials and an explicit project name. |
| B5-T77 | Switch production and local LLM configurations to GPT 5.6 Luna with auto reasoning and Gemini 3.7 Flash fallback | AI/BE/Infra/Docs | DONE | 2026-08-22 20:31:00 EDT | Updated all application LLM defaults and Railway production environment variables across agents and backend services to `openai/gpt-5.6-luna` with `google/gemini-3.7-flash` fallback, implemented OpenRouter auto reasoning via `reasoning: {"exclude": true}`, updated model catalogs and environment files, and passed all regression test suites. |
| B5-T76 | Complete the follow-up Fallow code-quality reduction across frontend controllers and shared UI | FE/Docs | DONE | 2026-07-14 22:46:00 EDT | Reduced Fallow health findings from 40 to 8 (critical 7→1, high 4→1, moderate 29→6), cleared all static and duplication findings, fixed the final review regressions, split production routes into bounded chunks, retained 157 passing frontend tests, and documented the remaining application-controller decomposition. |
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
| P5-T06 | Implement invite-link signup onboarding, admin metrics dashboard, and admin user-management controls | BE/FE/Docs | DONE | 2026-04-10 10:42:00 EDT | Added Supabase invite provisioning plus Resend invite emails, tokenized signup acceptance with mandatory onboarding fields and password policy, admin metrics + user management APIs/UI, and aligned schema/runbook/PRD docs. |
| P5-T07 | Add Resume Judge post-generation scoring, persisted score state, and detail-page score breakdown UI | AI/BE/FE/Docs | DONE | 2026-05-24 16:45:00 EDT | Added an OpenRouter-backed Resume Judge agent with primary/fallback config and reasoning envs, queued it after generation/full regen/section regen plus manual re-evaluate, persisted `applications.resume_judge_result`, surfaced a clickable score tile and breakdown dialog, aligned migration/schema/prompt docs, and preserved recommendations/regeneration for all scores below 90%. |
| P5-T08 | Add application activity log timeline endpoint and detail-page side panel with expandable AI diagnostics | BE/FE/Docs | DONE | 2026-05-25 10:53:18 EDT | Refined Activity Log side panel with a continuous vertical timeline UI, color-coded status dots, hover highlight styling, and indented border-left detail panels; enriches historical extractions with job details and judge completed events with displays/verdicts/notes; enriches started generation and regeneration events with length/aggressiveness; calculates accurate generation/regeneration durations by reading from queuing start timestamps; hides empty details toggles for queue events; validated the focused backend and frontend activity test surfaces. |
| P5-T09 | Differentiate regeneration with judge feedback and enrich activity log with models, duration, and instructions | AI/BE/FE/Docs | DONE | 2026-05-25 17:10:00 EDT | Differentiated Regeneration with Judge Feedback across title/summary/metadata; enriches extraction and regeneration success events in the activity log with extraction/LLM model names and durations; exposes user instructions and judge recommendations inline in the timeline details; updated judge dialog trigger, API schemas, vitest suites, and backend pytest suite. |
| P5-T10 | Add ATS keyword extraction and exact draft coverage metrics | AI/BE/FE/Docs | DONE | 2026-06-15 22:05:00 EDT | Added nullable `applications.job_keywords`, worker keyword extraction with exact-JD post-filtering, queued reruns when job descriptions change, deterministic case-insensitive exact phrase draft coverage, generation prompt keyword targets for low/medium/high aggressiveness, and a collapsed application-detail keyword panel with match and missing states. |
| P5-T11 | Add ATS keyword modal, manual keywords, and targeted optimization | AI/BE/FE/Docs | DONE | 2026-06-17 10:45:00 EDT | Replaced inline keyword expansion with a Resume Judge-style modal, added persisted manual keywords in `applications.job_keywords`, added exact-match coverage across extracted and manual phrases, added a quota-consuming keyword optimization regeneration target with minimal-change prompt guidance and matched-count regression guard, and covered backend/agent/frontend regression surfaces. |

### Bug Fixes

| Task ID | Task | Type | Status | Date updated | Comments |
|---|---|---|---|---|---|
| B5-T75 | Remediate calibrated Fallow dead-code, duplication, and concentrated frontend complexity findings | FE/Docs | DONE | 2026-07-14 21:35:00 EDT | Removed all reported dead code and clone groups, consolidated modal/auth/API/navigation/activity primitives, reduced critical complexity findings from 12 to 7 and high findings from 10 to 4, retained 153 passing frontend tests, and documented the remaining route-decomposition backlog. |
| B5-T74 | Audit and harden database, API, extraction, upload, extension, and dependency security | BE/AI/FE/DB/Infra/Docs | DONE | 2026-07-14 15:30:00 EDT | Added forced RLS and explicit repository access contexts for all application tables, shared Redis route limits, SSRF and upload defenses, atomic refresh rotation, production configuration and response-header guards, reduced Chrome extension permissions, upgraded vulnerable dependencies, ran Fallow 3.5.0, and documented rollout plus residual risks. |
| B5-T73 | Restore Railway backend after migration and network binding drift | BE/Infra/Docs | DONE | 2026-06-30 22:15:00 EDT | Applied and recorded the missing additive `applications.job_keywords` production migration, added explicit IPv4 and IPv6 backend listeners for Railway public-edge and private-service traffic, split dependency and source installation into cacheable Docker layers, and added deployment-contract regression tests. |
| B5-T72 | Tighten source-aware resume length conformance | AI/BE/FE/Docs | DONE | 2026-06-24 19:21:20 EDT | Full initial generation and full regeneration now enforce a stricter source-aware minimum for every page-length target, prompts include source word count and minimum acceptable words, keyword optimization and section regeneration use non-full-draft length modes, source-limited warnings include safe count metadata, and activity events record sanitized length diagnostics. |
| B5-T71 | Polish ATS keyword modal chip statuses and section layout | FE | DONE | 2026-06-23 18:43 EDT | Removed visible matched/missing text from keyword chips in favor of green/red highlighting, flattened the modal internals from nested card blocks into sectioned content with a side rail, and added focused frontend regression coverage. |
| B5-T69 | Harden ATS keyword extraction timeout, callback, and exact-match handling | AI/BE/FE/Docs | DONE | 2026-06-17 09:37:56 EDT | Added bounded keyword model attempts with fallback and failed callbacks, backend re-filtering for worker callback keywords, stale queued/running keyword recovery, punctuation-safe exact phrase boundaries, a public draft-save keyword-match service method, first-load draft invalidation suppression, and focused backend/worker/frontend regression coverage. |
| B5-T70 | Address ATS keyword workflow code review hardening | AI/BE/Docs | DONE | 2026-06-17 20:44:46 EDT | Removed the duplicate keyword LLM timeout wrapper, moved ATS keyword extraction out of the primary extraction success path into the standalone queued worker flow, refreshed application state before cached keyword optimization regression checks, fixed stale keyword recovery timestamp fallback, enforced preservation of already matched keyword phrases during optimization, clarified route logging and keyword contract docs, and added regression coverage for source hashes, stale fallback, cached optimization races, extraction-success keyword queueing, and preserve-keyword swaps. |
| B5-T68 | Apply nullable application URL migration in Railway production for pasted-description-only intake | Infra | DONE | 2026-06-07 22:54:00 EDT | Applied `20260607_000016_allow_nullable_application_job_url.sql` inside the Railway production backend container, verified `applications.job_url` is nullable, verified the non-blank check remains for populated URLs, and confirmed the migration is recorded in `app_meta.schema_migrations`. |
| B5-T67 | Harden URL-less intake follow-ups from code review triage | BE/FE | DONE | 2026-06-07 21:33:40 EDT | Added bounded pasted/captured source payload validation, protected retry/recovery/manual-entry/create handlers with immediate in-flight guards, hid both URL retry controls for URL-less applications, and added focused backend/frontend regression coverage. |
| B5-T66 | Allow pasted-description-only application intake without a job URL | BE/FE/AI/Docs | DONE | 2026-06-07 16:12:05 EDT | New Application intake now supports a paste-description mode that requires only job text, stores nullable `applications.job_url`, queues capture-backed extraction without inventing source URLs, hides source-link UI when absent, and keeps URL-only plus URL-with-pasted-text flows intact. |
| B5-T65 | Triage Fallow output and create prioritized remediation plan | Docs | DONE | 2026-06-07 14:23:00 EDT | Added `docs/engineering/fallow-remediation-plan-jun7-2026.md`, calibrated Fallow with `.fallowrc.json`, and saved `docs/engineering/fallow-output-2-after-config-jun7-2026.json`; static check findings dropped from 22 to 14 after verified runtime/test false positives were removed. |
| B5-T64 | Make high-aggressiveness Professional Experience title rewrites active when grounded | AI/Docs | DONE | 2026-06-05 00:16:09 EDT | High-aggressiveness prompts now instruct the resume-writing agent to set `jobs[].title` to a target-aligned truthful rewrite when demonstrated responsibilities support it instead of defaulting to the source title; payloads include a mode-specific title rewrite policy, seniority validation treats manager/supervisor/director wording as seniority-bearing, and focused agent tests plus prompt/PRD docs were updated. |
| B5-T63 | Auto-redirect authenticated users on landing page and login page mount | FE/Docs | DONE | 2026-06-04 19:05:00 EDT | Added silent session checks and automatic redirection to `/app` for authenticated users on `LandingPage` and `LoginPage` mount, resolving issues where users with active sessions are prompted to log in again after closing the browser. |
| B5-T62 | Fix mobile layout issues on landing page, login page, and signup pages | FE/Docs | DONE | 2026-06-04 09:38:00 EDT | Adjusted landing page hero heading font size to scale on mobile, aligned landing actions horizontally side-by-side on mobile, hid decorative illustration on mobile view for login and signup pages, and aligned the form content to the top to prevent clipping on small viewports. |
| B5-T61 | Update branding, modernize Open Graph image, optimize meta tags, and add PWA manifest | FE/Docs | DONE | 2026-06-03 19:00:00 EDT | Overwrote the old extension logo with the main Applix logo, created a new PWA manifest config, optimized Open Graph and iOS-specific web app metadata in index.html, and completely modernized the og-image.svg with a premium dark-themed vector design featuring brand gradients and a glassmorphic tailored resume visualization. |
| B5-T60 | Redesign features section with modern micro-animations and update feature highlights | FE/Docs | DONE | 2026-06-03 18:40:00 EDT | Redesigned the public landing page features section with themed icons, subtle hover lifts, expanding radial glowing backgrounds, and micro-animated icon interactions; updated the highlighted features copy for capture, tailoring, judge, and centralized pipeline workspace using user-driven value messaging without em-dashes; updated auth.test.tsx Vitest suite to cover the redesigned elements. |
| B5-T59 | Harden public beta access requests against abuse and transient email delivery failures | BE/FE/Docs | DONE | 2026-06-03 17:48:26 EDT | Tightened access-request email validation, added non-persistent duplicate suppression plus client-IP rate limiting for the public endpoint, fail-closed delivery-receipt checks, bounded Resend retries, and focused backend/frontend regression coverage while preserving the PRD rule that requester records are not persisted. |
| B5-T57 | Consolidate workspace actions dropdown, add Full Regen modal with custom instructions, and style status/comparison elements | FE/Docs | DONE | 2026-06-02 11:42:59 EDT | Consolidated export, applied, and viewing actions into PageHeader actions; added confirmation modal with optional custom instructions input for Full Regen (augmenting settings-level instructions); changed mark applied icon to a Check; displayed a timestamp-free Applied badge and a prominent Close Comparison button next to the Activity button; review fixes preserve Full Regen modal input on failed starts, add Actions menu ARIA state, and cover the updated interactions with focused tests. |
| B5-T58 | Add public landing page and beta access-request flow | FE/BE/Docs | DONE | 2026-06-03 11:03:48 EDT | Root route now shows a public Applix landing page with feature and pricing sections, realistic mock app data, and login/sign-up CTAs; no-token signup submits a public beta access request; backend sends sanitized admin emails through Resend and fails closed when delivery is unavailable; PRD, decision log, and task-output notes are aligned. |
| B5-T56 | Restore local compose backend connectivity for dev login | Infra | DONE | 2026-05-26 10:38:39 EDT | Local Docker Compose now overrides the backend command to bind Uvicorn to `0.0.0.0`, fixing host-to-container connection resets on `/api/auth/login` while leaving the Dockerfile command untouched for non-compose deployments. |
| B5-T55 | Replace Markdown-in-section resume agent output with semantic JSON contracts | AI/BE/FE/Docs | DONE | 2026-05-26 10:03:29 EDT | Resume-writing agents now return strict semantic JSON section content rendered to Markdown locally, generation filters to user-enabled source-supported sections including Projects and Certifications, Resume Judge recommendations are section-keyed JSON, extraction/cleanup prompts have explicit JSON contracts, and code-review follow-ups added semantic section-map normalization, compound heading aliases, and focused agent/backend/frontend regression tests. |
| B5-T54 | Apply code review refactoring fixes across backend and frontend layers | AI/BE/FE/Docs | DONE | 2026-05-25 17:55:00 EDT | Resolved 7 safe_auto findings from interactive review: extracted ISO timestamp parsing, judge instructions retrieval, and duration calculations into shared static helpers in `ApplicationService`; added defensive type guards and warning logs inside bare except blocks; removed ad-hoc console.info/console.warn logging statements from all frontend `api.ts` production paths; verified 100% test integrity. |
| B5-T53 | Fix application activity follow-ups and Railway same-origin API proxy hardening | AI/BE/FE/Infra/Docs | DONE | 2026-05-25 15:35:00 EDT | Code review follow-ups moved generation attempt diagnostics out of persisted draft settings and into callback/activity metadata, refreshed activity queries after terminal async updates, made non-expandable activity rows non-interactive, added `www.applix.ca` to production CORS defaults, hardened the Railway nginx `/api` proxy against stale private-DNS answers, and changed the backend container to listen on the dual-stack host recommended for Railway private networking. |
| B5-T52 | Harden regeneration callback payload coverage and Resume Judge threshold guardrails | AI/BE/Docs | DONE | 2026-05-24 17:56:05 EDT | Refactored `run_regeneration_job` failure callback emission into one helper path, added regression tests for regeneration validation-failure/timeout/unexpected-error payloads (including `regeneration_target`), added full-regeneration success coverage, expanded regeneration settings persistence assertions, added utility tests for `_stored_generation_settings` and `_quota_period_start`, removed a dead ternary in Resume Judge fallback invocation, and centralized the 90.0 regeneration-guidance threshold into a named constant used by both prompt text and scoring logic. |
| B5-T51 | Align Resume Judge prompt instructions with the preserved-under-90 recommendation flow | AI/Docs | DONE | 2026-05-24 17:06:26 EDT | Updated the Resume Judge system prompt so borderline passing drafts below the local 90.0 score threshold may still return regeneration guidance, added a regression test around the prompt text, and kept the prompt catalog aligned with the live behavior. |
| B5-T50 | Fix Railway selective deploy workflow so service-root Docker builds stop failing on CLI deploys | Infra | DONE | 2026-05-24 15:38:47 EDT | Investigated the failed Railway deploys triggered after commit `22d86ea2ef8000a737d30485a21e76e3d9b7bc06` and confirmed the app services themselves were already running successfully from Railway's repo-linked Dockerfile builds. The failures came from `.github/workflows/deploy-railway-main.yml` using `railway up <service> --path-as-root`, which uploaded each service directory as the archive root while Railway still resolved the stored `/backend`, `/frontend`, and `/agents` root directories, causing `directory ... does not exist` build errors in Railpack. The workflow now calls `railway up` from the repo root with explicit project/environment/service targeting so Railway can reuse the stored service root directory and Dockerfile paths correctly. |
| B5-T49 | Fix ErrorBanner follow-ups for client-side generation blockers and non-dismissible query failures | FE/Docs | DONE | 2026-05-24 14:35:16 EDT | Expanded `ErrorBanner` job-detail matching so detail-page retry blockers like missing job title/description still render the contextual action-required copy, and hid the dismiss action on applications/resumes pages when the banner is showing an underlying query load failure that cannot actually be cleared from local UI state. Added focused Vitest regression coverage for both behaviors. |
| B5-T48 | Refactor UI error handling with premium, context-aware ErrorBanner components and actionable CTA navigation | FE/BE/Docs | DONE | 2026-05-24 14:30:00 EDT | Created a context-aware ErrorBanner supporting targeted copy and CTAs for incomplete profiles (linking to /app/profile), missing base resumes (linking to /app/resumes), missing job details, quota limits, and markdown layout mismatches. Integrated it across all core views, resolved timing-related query retry delays in JSDOM tests, optimized mock setups, and validated 100% of the Vitest suite (114/114 passing). |
| B5-T47 | Block generate requests from non-ready application states before they hit the API | FE/BE | DONE | 2026-05-24 13:33:48 EDT | The detail page now requires an application to be in `generation_pending` or `resume_ready` before enabling initial generation, surfaces graceful blockers for manual entry and duplicate review, and the backend tells duplicate users to review the warning and choose Proceed Anyway before generating instead of returning a generic readiness error. |
| B5-T42 | Strip embedded NUL bytes from application update payloads before Postgres writes | BE | DONE | 2026-05-16 13:39:21 EDT | Production extraction callbacks could surface scraped text containing `0x00`, which caused `psycopg.DataError` when persisting application detail updates. `ApplicationRepository.update_application` now recursively strips NUL bytes from plain text and JSONB payloads before executing the update, with focused regression coverage for both text columns and nested JSON fields. |
| B5-T46 | Add admin model/reasoning dropdowns and dashboard request quota display | BE/FE/AI/Docs | DONE | 2026-05-24 13:15:00 EDT | Added curated OpenRouter model options for Gemini 3 Flash, GPT 5.4 Mini, DeepSeek V4 Flash, and Gemini 3.5 Flash with model-aware reasoning tiers, stored primary/fallback reasoning per subscription tier, passed tier model/reasoning through worker generation and repair, exposed monthly quota status in session bootstrap, showed dashboard requests remaining, returned sanitized quota-exhausted errors, and hardened review follow-ups for failed-job quota refunds, worker catalog validation, object-detail API errors, admin validation, and focused regression coverage. |
| B5-T45 | Harden subscription quota and tier-setting validation follow-ups | BE/FE/AI/Docs | DONE | 2026-05-25 10:38:02 EDT | Closed quota leak windows before job enqueueing, kept queued jobs counted even if later progress bookkeeping fails, added queue-failure release coverage for generation and section regeneration, rejected inactive tier assignment plus excessive or malformed tier settings, improved worker diagnostics for blank tier model values, added frontend pre-submit model validation, and mapped quota lock contention to a recoverable `quota_busy` response. |
| B5-T44 | Add subscription tiers, monthly generation quotas, and tier-selected generation models | AI/BE/FE/Docs | DONE | 2026-05-23 19:31:20 EDT | Added Basic and Pro subscription tiers with admin-editable monthly resume-writing quotas and primary/fallback OpenRouter model IDs, assigned users to tiers from admin user management, enforced one shared UTC monthly quota across initial generation, full regeneration, and section regeneration, and updated the worker to use tier-selected generation models while retaining env fallback compatibility. |
| B5-T43 | Make selected resume page length a source-aware content target | AI/BE/FE/Docs | DONE | 2026-05-16 17:42:00 EDT | Generation prompts now preserve grounded source detail for 2-page and 3-page targets, deterministic validation fails underfilled drafts below a source-aware minimum and repairs them once, source-limited drafts surface a draft warning instead of being padded, and Resume Judge caps length scores for under-target non-source-limited drafts. |
| B5-T41 | Fail generation validation when Professional Experience rows are malformed even without source anchors | AI | DONE | 2026-04-19 19:34:40 EDT | Tightened deterministic Professional Experience validation so malformed multi-header role blocks are rejected even when the source resume does not yield parseable anchors, preventing worker-side false-success callbacks that backend markdown normalization would later reject with HTTP 400. |
| B5-T40 | Harden base resume delete against dependent-row foreign-key drift and return conflict instead of 500 | BE | DONE | 2026-04-19 14:04:14 EDT | Base resume deletion now proactively clears `profiles.default_base_resume_id` and `applications.base_resume_id` references inside the same transaction before removing the resume, and service-level mapping now converts residual FK violations into a conflict error instead of leaking a generic 500. |
| B5-T39 | Allow base resume deletion from UI even when applications reference the resume | FE | DONE | 2026-04-19 13:35:41 EDT | Updated the frontend delete API helper to default `force=true`, so confirmed resume deletes no longer fail with a 400 when the resume is still referenced by applications and backend `ON DELETE SET NULL` cleanup can proceed. |
| B5-T38 | Accept wrapped structured bullets during generation sync and fail closed cleanly on cached-sync parse errors | BE | DONE | 2026-04-19 12:23:40 EDT | The shared resume render parser now accepts indented continuation lines inside structured Experience and Education bullets, preventing valid generated drafts from being rejected during generation callback sync, and terminal progress reconciliation now catches cached generation parse failures so application detail reads degrade into the existing sync-failure state instead of returning a transient 400. |
| B5-T37 | Preserve structured-draft Markdown fidelity and recover draft hydration after terminal-progress fallback | BE/FE | DONE | 2026-04-19 12:12:56 EDT | Structured resume normalization now preserves inline Markdown instead of flattening bullets and headers, legacy school-first education rows such as `MIT | MBA | 2022` keep their original school/degree order, and the detail page re-invalidates the draft when a newer live `resume_ready` detail arrives after an earlier polling-fallback completion path. |
| B5-T36 | Forward generation reasoning effort into the local agents container so Compose respects env overrides | Infra | DONE | 2026-04-19 11:58:34 EDT | `docker-compose.yml` now passes `GENERATION_AGENT_REASONING_EFFORT` into the `agents` service instead of silently falling back to the worker default `none`, and agents regression coverage now asserts both generation and Resume Judge reasoning-effort envs are wired through local Compose. |
| B5-T34 | Collapse generation-success recovery into a single queued Resume Judge update and consume cached success payloads atomically | BE | DONE | 2026-04-18 09:22:05 EDT | Railway production was exposing a race where terminal generation progress became visible before the backend had persisted the queued Resume Judge state, while concurrent detail/progress reads could replay the same cached generation success and enqueue duplicate judge runs. The backend now publishes `resume_ready` together with the queued judge state in one update and uses atomic cache consumption during callback-miss recovery so only one request can reconcile a cached success payload. |
| B5-T35 | Reduce detail-page live-update overfetch and immediately hydrate the generated draft after live completion | FE | DONE | 2026-04-19 11:49:03 EDT | The detail page now treats 5-second detail/progress polling as a stale-stream watchdog instead of always running alongside SSE, avoids re-fetching the current application after already applying a fresh response, and invalidates the draft query when a live `resume_ready` transition lands so the generated resume and Resume Judge card appear without a manual refresh. |
| B5-T33 | Replace detail-page polling with per-application SSE plus a 5-second watchdog fallback | FE/BE/Docs | DONE | 2026-04-17 22:10:54 EDT | Added an authenticated per-application SSE stream for extraction/generation/regeneration/judge updates, Redis-backed progress/detail event publishing, a fetch-based frontend stream hook that updates the shared query cache, and kept 5-second detail/progress watchdog polling for recovery and reconnect fallback. |
| B5-T32 | Keep the persisted generated draft visible across detail-page refreshes until regeneration completes | FE | DONE | 2026-04-17 22:15:00 EDT | The application detail page now always refetches any saved draft after the application shell loads, preserves the existing generated resume behind the in-flight generation or regeneration overlay instead of dropping to the empty state, and adds frontend regression coverage for refreshing into an active full-regeneration state. |
| B5-T31 | Preserve build-time frontend env fallbacks and stop query-cache regressions from clobbering profile, notes, and admin state | FE | DONE | 2026-04-17 21:33:43 EDT | Frontend runtime config now ignores unset runtime env overrides so production builds keep baked values, notes autosave no longer rehydrates the whole application detail form, admin-user mutations invalidate every cached filter variant, and the profile page now surfaces bootstrap failures instead of hanging behind a perpetual skeleton. |
| B5-T30 | Move the frontend to a production runtime, centralize shared query caching, and remove redundant shell/page overfetching | FE/BE/Docs | DONE | 2026-04-17 20:45:00 EDT | Replaced the Railway-facing frontend dev server with a production nginx runtime plus runtime-injected env config, added a shared React Query cache layer for bootstrap/applications/detail/base-resumes/admin/notifications, removed the shell-wide applications preload and notification event bus, extended bootstrap with aggregate application summary counts for shell badges, and added focused regression coverage for request counts plus notification invalidation behavior. |
| B5-T29 | Retry generation and Resume Judge without a reasoning payload when providers reject explicit `effort=\"none\"` as mandatory | AI/Docs | DONE | 2026-04-17 18:31:46 EDT | Extended reasoning-error detection to catch provider messages such as "reasoning is mandatory" and "cannot be disabled", so explicit `none` first attempts now downgrade to one same-model retry without the `reasoning` field before failing over. Added focused regression coverage and updated the prompt catalog. |
| B5-T28 | Send explicit OpenRouter `reasoning.effort=\"none\"` for generation and Resume Judge so non-reasoning runs do not inherit provider defaults | AI/Docs | DONE | 2026-04-17 18:31:46 EDT | Generation and Resume Judge now serialize `none` as an explicit OpenRouter reasoning payload instead of omitting the field, which prevents reasoning-capable models from silently using provider-default reasoning depth and timing out on otherwise valid requests. Added regression coverage and aligned the prompt catalog. |
| B5-T27 | Invalidate stale Resume Judge state across draft edits, job-detail changes, and generation-time base resume snapshots | AI/BE/FE | DONE | 2026-04-17 12:40:07 EDT | Resume Judge now compares and persists the active job-context signature, ignores stale worker callbacks after job-detail edits, stores the generation-time base resume snapshot with each draft so grounding checks use the source that actually produced the draft, and keeps stale queued/running judge states out of the completed-score UI with added backend, worker, and frontend regression coverage. |
| B5-T26 | Move Resume Judge to the detail-page left rail and redesign the reviewer breakdown hierarchy | FE/Docs | DONE | 2026-04-17 14:15:00 EDT | Moved Resume Judge into a single dedicated left-rail card above Job Description for all draft states, removed the generated-resume header tile, redesigned the breakdown dialog with smaller summary hierarchy plus stacked expandable dimension rows, and added frontend regression coverage for pending, queued, failed, stale, and scored review flows. |
| B5-T25 | Align PRD with compare-first review flow for JD-driven additions | FE/Docs | DONE | 2026-04-16 23:50:07 EDT | Removed the regenerated warning-panel restoration so the detail page again relies on compare mode as the explicit MVP review path, updated regression coverage to keep the draft view free of the old `review_flags` card, and rewrote the PRD/decision log to describe compare as the required review workflow before apply/export. |
| B5-T24 | Restore generation-settings dirty tracking and generated-draft review-flag warnings | FE | DONE | 2026-04-16 23:44:35 EDT | Rebased generation-settings dirty detection on persisted draft/detail values so local page-length, aggressiveness, and instruction edits no longer mark themselves as already saved, restored the generated-draft `review_flags` warning card required for medium/high JD-only additions, and added regression coverage for both behaviors. |
| B5-T23 | Remove compare-mode diff highlighting and keep side-by-side resume preview plain | FE | DONE | 2026-04-16 23:24:42 EDT | Removed the generated-vs-base diff renderer and all compare highlight styling so both compare panes now use the same plain markdown preview, updated compare copy and regression coverage to assert no diff classes remain, and confirmed the remaining base-resume bullet issue is rooted in stored resume markdown quality rather than the preview component. |
| B5-T22 | Fix compare-mode markdown preview fidelity and align diff highlights to the spruce theme | FE | DONE | 2026-04-16 23:24:42 EDT | Restored plain `ReactMarkdown` rendering for standard/base-resume preview surfaces, moved generated-vs-base diff logic into a dedicated generated-preview renderer so headings and bullets no longer leak raw markdown syntax in compare mode, replaced the two-tone ember diff treatment with a single spruce highlight treatment, and made diff matching section-aware so reordered `##` sections such as Skills and Education no longer get flagged as wholly generated. |
| B5-T21 | Add immersive application-detail compare mode and inline generated-vs-base draft diff highlighting | FE/Docs | DONE | 2026-04-16 23:10:00 EDT | Removed the generated-workspace review-flags card, added shell-owned `default`/`immersive` layout mode so compare can hide the app sidebar and left rail without unmounting local form state, loaded the generation-time base resume via `draft.generation_params.base_resume_id` for a full-width generated-vs-base compare workspace, and extended Markdown preview rendering with block-aware inline diff highlighting plus failure-closed compare fallback coverage. |
| B5-T20 | Fix high-tailoring sparse-role validation, preserve draft review-flag provenance, and keep repair inside the remaining timeout budget | AI/BE/Docs | DONE | 2026-04-16 23:02:00 EDT | High-aggressiveness validation now allows a single rewritten bullet to satisfy the tailoring heuristic when only one checked source bullet exists, generation and regeneration persist the draft's source `base_resume_id` so review flags continue comparing against the resume that actually produced the draft even after settings change, and validation-repair attempts now consume only the remaining wall-clock budget inside the PRD timeout ceiling instead of starting a fresh repair window. |
| B5-T19 | Make generation and regeneration reasoning effort env-configurable | AI/Docs | DONE | 2026-04-16 22:38:50 EDT | Added env-backed `GENERATION_AGENT_REASONING_EFFORT` with validated values `none|low|medium|high|xhigh`, threaded it through generation and section regeneration for both primary and fallback attempts, kept repair non-reasoning, and set the tracked dotenv defaults to `none`. |
| B5-T18 | Make medium/high Professional Experience tailoring mandatory enough to visibly change bullets and grounded titles | AI/BE/Docs | DONE | 2026-04-16 22:20:00 EDT | Restored generation/regeneration reasoning defaults to `medium` while keeping repair non-reasoning, rewrote medium/high prompt contracts so Professional Experience is the primary tailoring surface with fixed role order, added deterministic heuristic validation for insufficient medium/high experience rewrites, passed that failure through the repair prompt, and expanded draft `review_flags` to catch JD-only Professional Experience title/header rewrites. |
| B5-T17 | Make medium/high tailoring materially different with JD keyword injection and explicit draft review flags | AI/BE/FE/Docs | DONE | 2026-04-15 21:20:00 EDT | Updated generation prompt contracts so medium/high can inject job-description-driven non-factual keyword/skill phrasing, kept deterministic company/date/title invariants and fail-closed factual guardrails, added per-mode generation temperature tuning (`low=0.2`, `medium=0.35`, `high=0.5`), and exposed read-time draft `review_flags` in `GET /api/applications/{id}/draft` so medium/high JD-only additions are explicitly surfaced in the detail UI for user review. |
| B5-T16 | Bound generation retries, add validation-aware repair, enrich diagnostics, and surface blocked-start reasons | AI/BE/FE/Docs | DONE | 2026-04-14 21:34:11 EDT | Generation and regeneration now use a bounded primary-structured then fallback-JSON pipeline with only reasoning-rejection downgrades on the same model, one repair-only pass after deterministic validation failure, richer sanitized attempt diagnostics across frontend/backend/worker flows, explicit frontend blocker messaging when generation never reaches the API, and generation defaults aligned to `openai/gpt-5-mini` primary plus `google/gemini-flash-1.5` fallback with `medium` reasoning for generation and regeneration. |
| B5-T15 | Add first-class DOCX export alongside shared export parsing and filename-aware downloads | BE/FE/Docs | DONE | 2026-04-12 16:10:00 EDT | Export now supports both PDF and DOCX from the latest draft, with shared markdown normalization and section parsing, Word-native DOCX formatting on Letter pages, format-aware success/failure handling, and frontend downloads that honor the server-provided filename. |
| B5-T14 | Improve PDF export readability with smarter spacing, safer bullet parsing, and higher minimum fit presets | BE/Docs | DONE | 2026-04-12 12:32:05 EDT | PDF export now uses roomier header and section spacing, light document-density spacing adjustments, safer bullet-item rendering that unwraps accidental nested list markup without stripping literal `*` content, and a higher minimum readable preset floor of 9.4pt/1.10 line-height. Added regression coverage for spacing CSS, density classification, list rendering, and preset bounds. |
| B5-T14 | Remove redundant generation-start callback blocking and restore PRD timeout ceilings | BE/AI | DONE | 2026-04-14 12:50:17 EDT | Generation/regeneration workers no longer block on redundant `event=started` callback delivery before LLM work begins, internal callback retry overhead is reduced to limit queue stalls, and both worker and backend timeout ceilings are realigned to the PRD contract (`240s` full generation/full regeneration, `120s` section regeneration). Added regression coverage for the timeout contract. |
| B5-T13 | Recover generation/regeneration completions when worker callbacks are unreachable | BE/AI/Docs | DONE | 2026-04-11 14:34:00 EDT | Generation/regeneration workers now cache success payloads before callback delivery and treat callback transport as best-effort so transient backend connect failures no longer abort finished jobs; backend progress reconciliation can persist cached drafts when callbacks are missed and fails closed when no cache is available. |
| B5-T12 | Make application delete resilient to dependent-row schema drift in production | BE | DONE | 2026-04-11 13:43:53 EDT | `ApplicationRepository.delete_application()` now proactively clears dependent `resume_drafts`, `notifications`, `usage_events` (when present), and self-referencing duplicate links before deleting the application row, preventing foreign-key-related production delete 500s when historical schema constraints differ from current `ON DELETE` behavior. |
| B5-T11 | Prevent Redis progress-store outages from causing application delete 500s | BE | DONE | 2026-04-11 13:28:46 EDT | `ApplicationService.delete_application()` now treats Redis progress fetch/reconcile/delete as best-effort with warning logs, preserving active-state guardrails while allowing DB deletion to complete when cache infrastructure is transiently unavailable. Added regression coverage for progress-store get/delete failure paths. |
| B5-T10 | Reconcile terminal workflow progress before delete so stale active states do not block valid application deletion | BE | DONE | 2026-04-11 13:21:02 EDT | `ApplicationService.delete_application()` now applies terminal extraction/generation progress reconciliation before enforcing active-state delete guards, preventing callback-missed terminal states from causing false delete blocks. Added regression coverage for terminal extraction and terminal generation progress delete paths. |
| B5-T09 | Reduce extraction callback log noise for handled transport failures | AI/Observability | DONE | 2026-04-11 13:10:05 EDT | Worker callback delivery failures for extraction `started`/`failed`/`succeeded` events are now logged as warnings with concise error context instead of full exception stack traces, reducing false “job failed” signals while preserving non-fatal fallback behavior. |
| B5-T08 | Reconcile callback-missed extraction success on detail fetch and avoid false manual-entry fallback in UI | BE/FE | DONE | 2026-04-11 13:03:46 EDT | `GET /api/applications/{id}` now runs extraction terminal-progress reconciliation so detail fetch can recover callback-missed success without waiting on a separate progress poll, and the detail-page extraction fallback now maps terminal success progress to `generation_pending` instead of showing a false `manual_entry_required` error state. |
| B5-T07 | Recover callback-missed extraction success from Redis payload cache during progress polling | BE/AI/Docs | DONE | 2026-04-11 12:35:17 EDT | Worker now caches successful extraction payloads in Redis before callback delivery and backend progress reconciliation can apply that cached payload when callback transport fails, preventing callback outages from converting completed extraction into `manual_entry_required`. |
| B5-T06 | Harden extraction callback delivery so terminal callback outages do not abort completed work | BE/AI/Docs | DONE | 2026-04-11 12:19:02 EDT | Increased worker callback retry/backoff tolerance, made extraction failure callbacks non-fatal after terminal progress writes, and decoupled extraction success completion from callback delivery so callback transport outages no longer convert completed extraction into immediate runtime failure. |
| B5-T05 | Keep extraction jobs running when the initial worker callback cannot reach backend | BE/AI/Docs | DONE | 2026-04-11 12:06:57 EDT | Updated extraction orchestration so `event=started` callback delivery is best-effort instead of fatal, preventing early job aborts during transient backend network flaps while preserving progress-driven and terminal reconciliation fallback paths. |
| B5-T04 | Reconcile extraction terminal progress when worker callbacks are unreachable and surface manual-entry fallback immediately | BE/FE | DONE | 2026-04-11 11:41:24 EDT | Added backend extraction terminal-progress reconciliation from Redis so callback delivery failures fail closed into `manual_entry_required` (including blocked-source inference and callback-sync failure handling), and updated frontend extraction polling to switch into manual-entry recovery when terminal progress arrives but detail refresh fails or remains stuck in active extraction state. |
| B4-T26 | Normalize export typography so section headers, subheaders, and content use one consistent scale | BE/FE | DONE | 2026-04-19 14:18:00 EDT | Reworked the PDF and DOCX type scale so every section heading shares one size, all structured entry rows share one subheader size, and all body content across Summary, Skills, bullets, and other prose shares one smaller content size. Also increased spacing between sections and between adjacent experience and education entries. |
| B4-T25 | Align PDF and DOCX structured entry typography with the web preview hierarchy | BE/FE | DONE | 2026-04-19 14:05:00 EDT | Removed forced uppercase on company and school names in structured exports, capped structured row fonts below section-heading size, reduced body and bullet text relative to entry headers, and added more spacing between adjacent experience and education entries so print output matches the web preview more closely. |
| B4-T24 | Add a shared deterministic render model for experience and education across preview, PDF, and DOCX | AI/BE/FE/Docs | DONE | 2026-04-19 13:30:00 EDT | Added a shared resume render/parser service, normalized structured Experience and Education blocks into a canonical two-row layout, exposed `render_model` on draft APIs, switched generated preview rendering to the semantic model, and aligned PDF/DOCX exports plus save-time validation around the same right-aligned metadata contract and readability spacing rules. |
| B5-T03 | Reduce full-regeneration timeout risk by lowering reasoning effort while keeping section regeneration high-reasoning | AI/Docs | DONE | 2026-04-10 15:03:36 EDT | Updated generation orchestration so initial generation and full regeneration use `medium` OpenRouter reasoning, while single-section regeneration stays on `high`; this preserves section-level depth but reduces full-regeneration timeout risk on slower models. Added regression coverage and updated prompt catalog docs accordingly. |
| B5-T02 | Enforce deterministic Professional Experience regeneration structure, longer generation timeouts, and full-regeneration caps | AI/BE/FE/Docs | DONE | 2026-04-10 13:30:00 EDT | Added deterministic Professional Experience anchors plus normalization and contract validation so company/date cannot drift, moved generation timeout contracts to 240s full and 120s section with stage-based progress messaging, switched generation model defaults to `z-ai/glm-5.1` with `anthropic/claude-sonnet-4.6` fallback, and enforced a non-admin cap of three full regenerations per application with admin bypass and contact-admin conflict guidance. |
| B5-T01 | Fail closed for admin invites when email delivery is disabled and surface Resend delivery failures | BE | DONE | 2026-04-10 11:52:07 EDT | Admin invite creation now blocks immediately when backend email notifications are disabled, and invite sends now record `invite_sent` failure metrics and return a clear actionable error when provider delivery fails instead of silently skipping email delivery. |
| B4-T23 | Add conditional section-spacing relief for one-page PDF readability | BE/Docs | DONE | 2026-04-10 10:30:10 EDT | One-page export validation now first attempts section-only spacing relief (section-to-section and heading-to-content separation) and keeps those readability gains only when the PDF still fits on one page. |
| B4-T22 | Improve one-page PDF page-fill efficiency with pre-export roominess validation | BE/Docs | DONE | 2026-04-10 10:18:18 EDT | Export now starts from larger density-first presets and, for `1_page` targets, validates roomier typography or spacing variants before finalizing so the PDF uses one page more evenly without spilling to page two. |
| B4-T21 | Rebalance one-page PDF fit density and emphasize Professional Experience role titles | BE/Docs | DONE | 2026-04-10 09:59:28 EDT | PDF export now uses a density-first preset ladder that tightens spacing before reducing font size, restores larger baseline readability when one-page content has room, and bolds only Professional Experience role-title split rows when the right column is a date range. |
| B4-T19 | Fix PDF export spacing and header replacement regressions, and warn more clearly about high aggressiveness | BE/FE/Docs | DONE | 2026-04-09 22:08:23 EDT | PDF export now keeps typography-derived spacing in physical print units instead of oversized `rem` values, export normalization replaces plain-text profile headers instead of duplicating them, and the Generation Settings UI plus PRD now warn more explicitly that High aggressiveness can make substantial changes and should be reviewed carefully. |
| B4-T20 | Tighten PDF export vertical spacing and extend autofit compression for true one-page outputs | BE/Docs | DONE | 2026-04-09 22:19:08 EDT | The export renderer now removes most top margins between stacked blocks, eliminates extra first-section offset, tightens list and split-row spacing, and adds deeper fallback presets with smaller print margins so one-page resumes are more likely to stay on a single actual PDF page. |
| B4-T18 | Fix profile PATCH JSONB binding and add sanitized diagnostics for profile-save failures | BE | DONE | 2026-04-09 21:29:34 EDT | `profiles.update_profile()` now wraps `section_preferences` and `section_order` values with psycopg `Jsonb` before `%s::jsonb` updates, preventing 500s when saving profile/preferences; the profile API now logs only exception class and attempted update field names on failure, and backend regression tests cover both JSONB wrapping and sanitized error logging. |
| B4-T17 | Increase base resume Markdown editor height to use 50% of viewport for easier long-form editing | FE | DONE | 2026-04-09 20:16:19 EDT | Updated base resume editor textareas in upload-review, blank-create, and existing-edit flows from `min-h-[500px]` to `min-h-[50vh]` so the Markdown editor uses more vertical screen space and reduces scrolling while editing. |
| B4-T16 | Fix dashboard monthly analytics labeling and aggregate low-volume job sources consistently | FE | DONE | 2026-04-09 10:32:47 EDT | The dashboard monthly chart now labels the second series as applications created in that month that are currently marked applied, and the job-sources card now rolls excess origins into an `Other` bucket so the list, percentages, pie slices, and total stay consistent. |
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
| A0-T39 | Replace Resume Judge timestamp freshness with semantic input signatures so export and no-op writes do not stale valid scores | BE/AI/FE/Docs | DONE | 2026-05-16 17:03:00 EDT | Resume Judge now persists an `input_signature` derived from normalized draft content, job context, generation settings, and base-resume fingerprint; backend callbacks and stale-state checks use that signature instead of `resume_drafts.updated_at`, exports backfill current legacy judge rows without staling them, the detail API returns a computed `is_stale` flag for the UI, and targeted backend/worker/frontend regression coverage now protects export freshness, unchanged-save behavior, and post-export callback acceptance. |
| A0-T38 | Restore protected-route session state after dev StrictMode refresh | FE | DONE | 2026-05-16 13:57:47 EDT | Reset the auth provider mounted guard when its effect is active so React StrictMode's development cleanup pass does not permanently suppress restored user state after successful refresh and `/auth/me` calls. Added regression coverage that restores a protected route inside `React.StrictMode` and leaves the invite-only loading shell for the workspace. |
| A0-T37 | Fail closed when protected-route session refresh stalls across split frontend or backend origins | FE | DONE | 2026-05-16 13:51:37 EDT | Added a bounded 10s timeout around auth refresh, `/api/auth/me`, and logout fetches, removed the unnecessary JSON `Content-Type` header from refresh/logout so page reloads avoid an extra cross-origin preflight, and added frontend regression coverage proving a hung refresh exits the loading shell and returns to login instead of leaving the user on the indefinite “Checking your invite-only session” screen. |
| A0-T36 | Restore production refresh-cookie persistence and unblock extraction detail reads for legacy failure payloads | BE/FE | DONE | 2026-05-16 13:43:52 EDT | Switched production refresh cookies to `SameSite=None` while preserving local-dev `SameSite=Lax`, which restores session refresh on full page reloads across the split frontend/backend origins, and relaxed application-detail extraction-failure serialization so older partial `extraction_failure_details` payloads no longer trigger `500` responses after extraction failures. |
| A0-T35 | Cut production off Supabase by provisioning Railway Postgres, rotating backend JWT keys, and reseeding admin invite access | Infra/Ops/Docs | DONE | 2026-05-16 12:11:00 EDT | Added an in-project Railway Postgres service, applied all repo-owned SQL migrations into the fresh database, repointed backend `DATABASE_URL` to Railway internal Postgres, set fresh production `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, removed stale Supabase-only production variables, redeployed backend, verified `/healthz` plus end-to-end invite accept/login/session bootstrap, and issued a fresh admin signup link for `sanka.lokuliyana@gmail.com`. |
| A0-T34 | Reinstate dedicated local auth dev-mode flags, refresh-aware frontend tokens, and an upgrade-safe custom-auth migration | FE/BE/Infra/Docs | DONE | 2026-05-16 11:56:05 EDT | Restored `APP_DEV_MODE` and `VITE_APP_DEV_MODE` as the local-only gate for email-only login and insecure local cookies, made frontend access-token caching expiry-aware with a one-shot refresh-on-401 retry path, and replaced the cleanup-only auth migration with an idempotent forward migration that backfills `public.users`, rewires FKs, and removes legacy auth/RLS artifacts for already-migrated databases. |
| A0-T33 | Consolidate local dev behavior under `APP_ENV` and remove redundant auth or UI mode flags | FE/BE/Infra/Docs | DONE | 2026-05-16 11:56:05 EDT | Superseded by A0-T34 after review: using `APP_ENV=development` as the sole auth-bypass switch was too broad for shared environments, so the repo now uses dedicated `APP_DEV_MODE` and `VITE_APP_DEV_MODE` flags for local-only email sign-in. |
| A0-T32 | Stop local auth from booting into a protected-route refresh failure before email-only sign-in | FE/Docs | DONE | 2026-05-16 09:10:25 EDT | Moved session restoration out of global frontend startup and into protected-route access only, changed the default unauthenticated entry route to `/login`, and documented that local auth dev mode accepts email-only sign-in without the old pre-login `401` refresh path. |
| A0-T31 | Fix Resume Judge rerun card nullability so Railway frontend builds pass | FE | DONE | 2026-04-18 08:50:37 EDT | Replaced the non-narrowed `resumeJudge.message` access in the max-attempts branch with an explicit nullable-safe read so `tsc --noEmit -p tsconfig.app.json` no longer fails during the Railway frontend build. |
| A0-T30 | Cap Resume Judge reruns and harden Railway callback delivery | AI/BE/FE/Infra | DONE | 2026-04-18 08:17:15 EDT | Added a three-run per-draft Resume Judge cap with persisted `run_attempt_count`, disabled stale retry loops in the detail UI after the third failed run, and hardened worker callback delivery to fall back from the stale Railway internal `:8000` backend URL to Railway-safe backend candidates after confirming production `agents` was misconfigured. |
| A0-T29 | Fix Railway frontend builds by bundling the workflow contract inside the frontend service | FE/Infra | DONE | 2026-04-17 22:33:08 EDT | Replaced the frontend's `@shared/workflow-contract.json` dependency with a frontend-bundled contract file and removed the stale shared-path aliases, so isolated Docker and Railway frontend builds no longer depend on repo-root files outside the frontend service context. |
| A0-T28 | Restore visible list bullets in shared resume preview rendering | FE | DONE | 2026-04-17 12:23:31 EDT | Updated the shared `MarkdownPreview` renderer to emit explicit unordered and ordered list marker classes instead of relying on ambient CSS defaults, which restores visible bullets in generated-draft preview and base-resume compare preview, and added focused regression coverage for the list-rendering contract. |
| A0-T27 | Tighten generated-resume preview controls into a stable top-right header and compare layout | FE | DONE | 2026-04-17 12:17:43 EDT | Moved preview/edit, compare, and regeneration controls into one consistent top-right header row, kept regeneration as a dropdown while restoring the original green gradient icon button treatment, converted generated and base resume metadata into muted chips, removed the redundant compare helper copy, tightened header-to-content spacing, and removed the inner preview frame so both compare panes read more like pages. |
| A0-T26 | Strengthen aggressiveness prompt differentiation, bounded title rewrites, and anti-filler voice rules | AI/FE/Docs | DONE | 2026-04-13 23:05:11 EDT | Low now keeps Professional Experience titles source-exact, medium allows only grounded title reframing with the same role family and seniority plus explicit bullet consolidation, high allows bounded inference plus more flexible role reframing while preserving company/date invariants, and the prompts/docs now include explicit anti-filler voice guidance, a dedicated high-inference worked example that appears only in high-mode prompts, and a note that medium title-family validation is only heuristic. |
| A0-T27 | Fix frontend runtime env script generation so production config loads without syntax errors | FE/Infra | DONE | 2026-04-18 07:52:47 EDT | Removed the leading-comma bug in `frontend/docker-entrypoint.sh` when writing `env-config.js`, redeployed the `frontend` Railway service from `frontend/`, and verified live `env-config.js` now parses correctly with populated `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL`. |
| A0-T28 | Apply missing production Resume Judge schema migration to restore applications API reads | BE/Infra | DONE | 2026-04-18 07:56:24 EDT | Applied the additive `applications.resume_judge_result jsonb` migration directly to production Postgres so backend `/api/applications` queries stopped failing with `UndefinedColumn`, then verified Railway HTTP logs returned `GET /api/applications 200`. |
| A0-T25 | Fix production session bootstrap failures by correcting workflow contract path resolution in backend containers | BE/Infra | DONE | 2026-04-11 09:59:40 EDT | Bundled `workflow-contract.json` inside `backend/app/core`, pointed backend contract loading to that packaged path by default, and kept repo-root fallbacks for local workflows, eliminating `/shared/workflow-contract.json` file-not-found crashes on `/api/session/bootstrap`. |
| A0-T25 | Restore Railway production availability by fixing frontend port routing and agents Redis config | Infra/Ops | DONE | 2026-04-18 07:45:36 EDT | Added missing production `REDIS_URL=redis://redis.railway.internal:6379/0` to `agents` so the ARQ worker stopped crash-looping on `localhost`, and set frontend `PORT=5173` to match the Railway domain target port so `frontend-production-b75c3.up.railway.app`, `applix.ca`, and `/app/applications` returned `200 OK` again. |
| A0-T24 | Seed admin invite account in production and issue signup token link | BE/Infra/Ops | DONE | 2026-04-11 09:46:29 EDT | Provisioned `sanka.lokuliyana@gmail.com` in Supabase Auth, forced `profiles.is_admin=true` and `is_active=true`, revoked stale pending invites, created a fresh pending invite token, and validated the public invite-preview endpoint resolves the token. |
| A0-T23 | Fix Railway runtime routing by binding backend to `$PORT` and allowing custom frontend domain host checks | FE/BE/Infra | DONE | 2026-04-11 09:26:27 EDT | Updated backend Docker CMD to bind Uvicorn to `PORT` (fallback `8000`) for Railway edge routing, and added `applix.ca` to Vite `server.allowedHosts` plus `preview.allowedHosts` so the custom frontend domain is not blocked. |
| A0-T22 | Fix Railway worker Redis connectivity by wiring service-to-service `REDIS_URL` in production | Infra | DONE | 2026-04-10 17:29:08 EDT | Set `REDIS_URL=redis://redis.railway.internal:6379/0` on both `agents` and `backend`, then redeployed services so ARQ worker no longer attempts localhost and connects to Railway Redis successfully. |
| A0-T21 | Allow Railway generated frontend hostnames in Vite to unblock production access | FE/Infra | DONE | 2026-04-10 17:24:29 EDT | Added `.up.railway.app` to Vite `server.allowedHosts` and `preview.allowedHosts`, then deployed frontend so Railway host-check no longer blocks `frontend-production-*.up.railway.app`. |
| A0-T20 | Wire push-to-main selective Railway deploys via GitHub Actions so only changed services redeploy | Infra/Docs | DONE | 2026-04-10 17:00:08 EDT | Created Railway project `job-app-prod` with `backend` and `frontend` services, added `.github/workflows/deploy-railway-main.yml` path-filtered deploy automation, and configured GitHub secrets for project/service IDs plus a dedicated Railway project token. |
| A0-T23 | Reorganize the prompt catalog into a mode-first resume-generation reference with shared deterministic rules | Docs | DONE | 2026-04-13 11:30:00 EDT | Reworked `docs/prompts.md` so resume generation and regeneration are grouped by shared logic plus low, medium, and high modes, including the live full-draft and section-regeneration prompt text, operation differences, target-length contracts, instruction filtering, validation rules, and deterministic Professional Experience invariants. |
| A0-T19 | Add semantic job-location extraction alongside compensation and expose it in the detail workspace | AI/BE/FE/Docs | DONE | 2026-04-09 20:56:55 EDT | Extraction now persists optional raw `job_location_text` separately from `compensation_text`, the prompt contract requires semantic separation even when both appear on the same rendered line, the detail workspace exposes Location for review and editing, and duplicate-review behavior remains unchanged when only location text changes. |
| A0-T18 | Make Markdown edit mode visually structured with highlighted headers in both resume editors | FE | DONE | 2026-04-09 20:42:10 EDT | Added a shared highlighted Markdown editor that keeps plain Markdown as the saved value, color-codes and bolds `#`, `##`, and `###` lines while editing, and wired it into both base-resume editing and application draft edit mode. |
| A0-T17 | Replace inline new-application intake with a modal and allow optional pasted-text creation | FE/BE/Docs | DONE | 2026-04-09 20:22:31 EDT | The applications page now opens a URL-first modal instead of an inline card, reveals pasted job text only when the user asks for it, and extends `POST /api/applications` so URL plus pasted source text can create and queue extraction directly from the modal. |
| A0-T17 | Fix resume export header duplication, add profile LinkedIn support, and tighten PDF page-fit behavior | AI/BE/FE/Docs | DONE | 2026-04-09 20:18:29 EDT | Resume assembly and export now use one profile-driven header with location plus LinkedIn support, initial generation and full regeneration or export fail closed when profile `name` is missing, and PDF export retries tighter WeasyPrint presets to better match the saved `page_length` target. |
| A0-T16 | Allow high-aggressiveness professional-experience title rewrites while keeping low and medium title-fixed | AI/FE/Docs | DONE | 2026-04-09 20:00:24 EDT | High aggressiveness now allows truthful role-title rewrites inside Professional Experience only, low and medium explicitly keep source role titles unchanged, the validator honors that high-only carveout, and the settings UI plus prompt catalog explain the rule clearly. |
| A0-T15 | Capture full posting text plus compensation and clarify aggressiveness settings in the detail workspace | AI/BE/FE/Docs | DONE | 2026-04-09 19:36:58 EDT | Extraction now stores the full primary posting body instead of a narrowed responsibilities excerpt, applications can persist optional raw `compensation_text`, the detail workspace exposes that field for review and editing, and the compact Generation Settings card now uses inline popovers to explain exactly what low, medium, and high will change. |
| A0-T14 | Keep attention-required notifications pinned when using inbox clear-all | FE/BE | DONE | 2026-04-09 19:17:57 EDT | Refined inbox clear-all so it deletes only non-action-required notifications, keeps attention items visible until the underlying issue is resolved, and updated backend plus frontend regression coverage to reflect the pinned-attention behavior. |
| A0-T13 | Refresh open application views after inbox clear and keep popup branding assets inside the extension root | FE | DONE | 2026-04-09 14:28:00 EDT | Clear-all inbox now broadcasts a frontend refresh event so the applications list and detail page immediately drop stale action-required UI, and the Chrome extension popup now loads its logo from an asset bundled inside `frontend/public/chrome-extension/` with regression coverage for both fixes. |
| A0-T12 | Align resume delete affordances with the shared icon-only destructive action pattern | FE | DONE | 2026-04-09 14:18:43 EDT | Replaced resume-card and resume-detail text delete buttons with the shared icon-only delete control, swapped browser confirms for the shared confirmation modal, and kept the existing resume delete flow plus regression coverage intact. |
| A0-T11 | Add clear-all inbox controls for top-bar notifications | FE/BE | DONE | 2026-04-09 14:15:55 EDT | Added a user-scoped clear-all notifications endpoint, wired a `Clear all` action into the top-bar inbox dropdown, refreshed shell attention state after clearing, and added backend plus frontend regression coverage for success and failure handling. |
| A0-T10 | Turn the top-bar notification bell into a scrollable inbox dropdown with linked application navigation | FE/BE | DONE | 2026-04-09 14:04:05 EDT | Added a user-scoped notifications inbox API, converted the bell into a dropdown that fetches newest-first notifications on open, keeps the existing attention badge semantics, scrolls for long lists, and routes linked notifications directly to their application detail page with frontend and backend regression coverage. |
| A0-T09 | Rebrand the user-facing app and extension surfaces to Applix with the new folder logo | FE/BE | DONE | 2026-04-09 14:00:11 EDT | Added the supplied folder logo as the canonical public asset, replaced login/sidebar/browser/extension branding with Applix, and updated user-facing backend email subjects plus the exposed API title while leaving internal bridge identifiers unchanged. |
| A0-T08 | Add icon-based application delete controls and user-triggered extraction stop recovery | FE/BE | DONE | 2026-04-09 13:59:38 EDT | Added icon-only delete controls in the applications table and detail header, introduced authenticated extraction-stop recovery with stale-callback fencing and no action-required notification, and updated the detail recovery UI so stuck extraction rows can be stopped, retried, or deleted safely. |
| A0-T06 | Rebuild the dashboard analytics layout around a full-width monthly activity area chart and compact quarter-row summary cards | FE | DONE | 2026-04-09 09:44:31 EDT | Dashboard analytics now place a full-width monthly activity card directly below the KPI row, render the yearly created-versus-applied trend with a `recharts` area chart and shared chart UI wrapper, convert job sources into a compact pie chart, and rebalance job sources, top companies, and status breakdown into a responsive equal-width row. |
| A0-T05 | Redesign the invite-only login page into a full-bleed branded auth surface with illustration-led composition | FE | DONE | 2026-04-08 22:18:41 EDT | Replaced the boxed login card with a full-viewport split layout, reused the existing Resume Builder / AI Workspace branding and theme fonts, added the businessman illustration as a frontend-served asset, and kept the existing auth flow, dev-mode messaging, and MVP signup restrictions intact. |
| A0-T07 | Add application-table delete, bulk apply or delete selection, and row-alignment fixes | FE/BE | DONE | 2026-04-09 09:25:55 EDT | Added user-scoped application deletion with active-work blocking and progress cleanup, introduced current-page selection with bulk mark-as-applied and bulk delete actions in the applications table, and top-aligned the compact row layout so status badges and row text share the same visual baseline. |
| A0-T04 | Tighten dashboard, applications, resumes, and extension UI density while normalizing status affordances | FE | DONE | 2026-04-08 22:16:10 EDT | Added compact card density primitives, normalized status badge sizing, unified the applied toggle treatment, stabilized application row heights with truncation, moved detail-page PDF export into the header action cluster, refreshed dashboard analytics visuals, added resume search, and tightened card spacing across the main frontend surfaces. |
| A0-T03 | Rework the authenticated frontend shell and primary pages to use a fluid full-width responsive layout | FE | DONE | 2026-04-08 21:14:34 EDT | Removed the authenticated shell max-width cap, added shared responsive gutters, expanded list and card layouts to use wide screens more effectively, and converted the application detail workspace to a responsive grid with a compact sticky settings rail and independent resume pane scrolling. |
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
- Implement the New Application flow as a URL-first intake with optional pasted-text submission.
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

- Generate an ATS-friendly section document via Pydantic AI + OpenRouter.
- Review the resume in one section workbench.
- Toggle the Applied flag independently of the primary status.
- Receive in-app notifications for workflow events.
- Receive email notifications for high-signal generation events.

## Phase 4 — Editing, Regeneration, and PDF Export

**Scope**

- Implement Markdown edit mode with persistent save behavior.
- Support single-section regeneration with required instructions.
- Support full regeneration with pre-filled prior settings and overwrite of the current draft.
- Implement on-demand PDF and DOCX export from the latest draft content with ATS-safe formatting.
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
- Export endpoints that stream generated PDF or DOCX files without storing them.
- In-app notifications for export success and failure, plus email notifications for export failures.

**Exit Criteria**

- A user can edit and save Markdown directly.
- Section regeneration rejects blank instructions and updates only the selected section.
- Full regeneration reuses and updates prior settings appropriately.
- Export produces a fresh PDF or DOCX file from the latest saved draft and does not persist the file.
- Editing or regeneration after export returns the application to `Needs Action`.

**PRD Acceptance Coverage**

- Edit section Markdown and nested entries with revision checks.
- Regenerate a single section with required instructions.
- Regenerate the full resume with updated settings and optional instructions.
- Export the current draft as a PDF or DOCX download.
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
| Generate an ATS-friendly section document via Pydantic AI + OpenRouter | Phase 3 |
| Review the resume in one section workbench | Phase 3 |
| Edit section Markdown and nested entries with revision checks | Phase 4 |
| Regenerate a single section with required instructions | Phase 4 |
| Regenerate the full resume with updated settings and optional instructions | Phase 4 |
| Export the current draft as a PDF or DOCX download | Phase 4 |
| See status return to `Needs Action` after editing or regenerating a previously exported resume | Phase 4 |
| Toggle the Applied flag independently of the primary status | Phase 1 and Phase 3 |
| Receive in-app notifications for all workflow events | Phase 1, Phase 3, and Phase 4 |
| Receive email notifications for high-signal events | Phase 1, Phase 3, and Phase 4 |
| Manage base resumes (create via file upload or form, edit, delete, set default) | Phase 2 |

## Notes for Future Task Updates

- Update each phase status and this document timestamp as implementation progresses.
- When a task changes schema, rollout order, compatibility, backfills, or post-deploy checks, update `docs/backend-database-migration-runbook.md` in the same task.
- Keep `docs/database_schema.md` and `docs/resume_builder_PRD_v3.md` aligned whenever status models, data contracts, or workflow behavior changes.
