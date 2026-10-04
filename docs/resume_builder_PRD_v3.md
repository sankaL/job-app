# Product Requirements Document — AI Resume Builder
**Version:** 3.1
**Status:** Draft for engineering handoff  
**Audience:** Engineer creating the technical solution design and build plan  

---

## 1. Overview

Build a private, invite-only web application that helps users generate ATS-friendly resumes tailored to specific job postings.

A user logs in, creates a job application from a job link or Chrome current-tab capture, and the system attempts to extract the job details and posting origin asynchronously. The user then selects a base resume, chooses generation settings, and the system produces a tailored resume draft in Markdown. The user can review, edit, regenerate sections, regenerate the full resume, inspect a Resume Judge quality score and breakdown, and export a PDF.

This is an MVP. The focus is a clean, reliable workflow with strong user feedback during async processing, clear attention states, and ATS-safe PDF and DOCX export formats with deterministic preview and export layout.

---

## 2. Goals

The product should enable a user to:

- Manage multiple job applications
- Maintain one or more base resumes
- Generate a tailored resume for a specific job posting
- Inspect exact ATS keyword phrases extracted from each job description and see deterministic draft coverage
- Edit the generated resume directly in Markdown
- Regenerate sections or the full resume with instructions
- Export the final resume as a PDF
- Receive clear in-app and email notifications for important events

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS + Astryx core / neutral theme |
| Backend | FastAPI (Python) |
| Database & Auth | Postgres + custom JWT auth |
| AI Orchestration | Pydantic AI with local validation and bounded section recovery |
| LLM Provider | OpenRouter (model-agnostic; see §3.1) |
| Web Scraping | Playwright (headless) |
| Email | Resend |
| Hosting | Railway |
| PDF Generation | On-demand WeasyPrint; DOCX uses python-docx |

### 3.1 OpenRouter / LLM Integration

All generative calls use **Pydantic AI + OpenRouter**. Model routing is determined by operation, independent of Basic/Pro subscriptions:

- Tier 1: `anthropic/claude-sonnet-5.5`, fallback `openai/gpt-6.1-sol`, for initial full generation and full regeneration.
- Tier 2: `google/gemini-3.8-flash`, fallback `openai/gpt-6-luna`, for section/individual-job regeneration, keyword optimization, extraction, factual audits, targeted repairs and manually requested Resume Judge scoring.
- Classification: `typesafe/jev-1.13` through Decisions; unavailable or uncertain classification preserves local parser results for review. Classification does not extract facts or approve source content.
- Local tools handle document parsing, contact information, schema/factual-field validation, keyword matching, comparison, assembly and export.

All generative models use provider-default reasoning. Do not apply subscription-specific effort overrides, including overrides in older queued jobs. Keep prompts portable and retain the shared Unslop writing policy on prompts that author prose (not on copy-only extraction, cleanup or claim-audit prompts). Current models use native JSON-schema output rather than forced output tools; strict local validation remains authoritative.

Basic includes 10 monthly writing requests and Pro includes 60. Both use the same models. Admins may change request allowances only. Initial generation, full regeneration, section/job regeneration and keyword optimization each reserve one request. Internal retries, fallbacks and validation do not consume additional requests; failed or cancelled operations refund their reservation. Imports, local edits and manually requested quality scoring do not consume writing requests.

Typed output correction, model fallback and targeted repairs share explicit request, output-token and wall-clock budgets. SDK retries are disabled. Resume jobs allow at most eight provider requests and 24,000 output tokens within the existing 240s full/120s section windows, which leaves room for provider fallbacks across three write/audit rounds. A repair round starts only when its write and audit both fit. Factual audits time out after 45s. When repairs or the request budget run out, generation fails as a section-verification failure that reports the real attempt count and asks the user to retry. Authentication/billing rejection stops model fallback. The first full-writing request may fall back within Tier 1 on provider/schema failure; subsequent semantic repairs and all factual audits use Tier 2. Repairs include typed, privacy-masked rejected output and rule codes; repeated semantic rejection switches the final repair writer to the Tier 2 fallback. Import assistance shares a 30s upload deadline. Tier 2 identifies role and education boundaries and factual fields by default; duty text is copied locally from validated source-line references.

LangSmith tracing uses explicit configuration, remains sanitized and best-effort, and is enabled for normal configured local and production LLM tasks. Unconfigured installations, automated tests and offline evaluations default to tracing off. Tracing availability must not change workflow outcomes. Automatic Resume Judge runs after generation are removed; scoring remains an explicit user action.

---

## 4. Access and Authentication

This is an **invite-only** application.

- No open public account creation in MVP
- The unauthenticated root route may show a marketing landing page with product features, informational pricing, login, and beta access-request CTAs
- Public access requests are email-only leads: they do not create accounts, persist requester records, or approve access automatically
- Public access requests must be rate-limited and suppress short-window duplicate submissions before triggering admin email delivery
- Admins invite users by email from an admin users screen
- Sending an invite pre-provisions the user in Supabase Auth and sends an invite link by email
- Invite links open a dedicated signup page (not a public signup page) where the invited user completes onboarding
- New and invited users default to the Basic subscription tier unless an admin changes the tier later
- Authentication: Supabase Auth — **email + password only**
- Invite signup requires password confirmation and password complexity: at least 12 characters with uppercase, lowercase, number, and symbol
- Password reset via Supabase's built-in email flow
- All application data is private to the authenticated user
- Supabase Row Level Security (RLS) must enforce per-user data isolation on all tables
- All application APIs require a valid Supabase JWT. Unauthenticated endpoints are limited to login, invite-link preview/accept endpoints, and the public access-request endpoint.
- Local dev login uses a dropdown of existing active accounts from the local database, including seeded users, with no password field. Its email-only user-list endpoint is available only in local dev mode and returns 404 otherwise. Production retains email/password login. The local login API still supports email-based fixture setup; selecting an account in the UI does not create users.

---

## 5. Core Product Principles

### 5.1 Resume sections are the editable source of truth
- Base resumes and drafts have a versioned document with stable section, entry and bullet IDs, reviewed facts and Markdown prose.
- Known types include Summary, Professional Experience, Education, Certifications, Projects and Skills; custom sections are supported without changing the schema.
- Markdown projections remain stored for compatibility and export. Contact information comes from the profile, outside the document.
- Summary is optional. Experience and Education are recommended, rather than universal blockers. At least one populated enabled section and review of all populated enabled source sections are required before generation.
- Uploads preserve the original extracted Markdown, require review, and may store local contact suggestions. Classification confidence is advisory and does not certify factual accuracy.

### 5.2 Personal information is not generated by the LLM
The LLM must not invent or generate: name, phone number, address or location text, email, city or location, LinkedIn URLs, or other contact links. Personal and contact information must be removed from resume content before any external LLM call that touches resume text, then reattached locally during assembly or formatting.

### 5.3 Resume generation is batched and validated by section
Initial generation and full regeneration batch writable sections into one typed request. Employer, dates, institutions, credentials and other reviewed entry fields stay local; Education and Certifications are copied directly. Each rewritten paragraph or bullet cites stable source IDs. Valid sections are retained while only failed sections are repaired, within the shared budget. A section action may target one experience entry, preserving siblings. Every draft stores the exact source revision used for generation; comparison and section/keyword regeneration use that snapshot. Full regeneration intentionally uses the latest reviewed base revision.

### 5.4 Generation must stay grounded in source material
The system should tailor, prioritize, rewrite, and reorganize content from the user's base resume, but must not invent credentials, employers, titles, dates, or work history. This is a hard product rule, not just a quality guideline.

Base resume review navigation uses single-line section names with ellipses and full-name tooltips. Reviewed sections have green dots; pending and excluded states remain distinct. Keep the review count and progress at the bottom of the desktop section sidebar. Base resume editor actions are grouped in the app shell top bar beside notifications. The resume-name edit action is a subtle standalone pencil beside the actual resume title. Excluded sections use a faint red background and a red exclusion label. Save feedback stays in the header save action and transient success/error messages, without a duplicate save-status footer or sidebar guidance.

Application draft generation and export timestamps and revision appear in small secondary text beside the company under the application title. The workbench starts directly with resume sections, without a separate “Generated resume” heading or preview instructions.

### 5.5 Strong user feedback during async actions
The app must provide meaningful loading, progress, success, error, and attention states throughout the entire workflow. At every stage, the user should understand what the system is doing, whether it succeeded or failed, and what they need to do next.

Action controls use Astryx Button styling throughout the app. Related actions shown together, including page actions, resume editing, row actions and dialog confirmations, form a connected Astryx ButtonGroup with consistent sizing. Each group has one designated main action. App-shell page-action primaries use orange backgrounds with white text; other primary buttons use the neutral theme’s black background. Other actions use secondary styling. The primary choice stays fixed during loading or disabled states. A single action remains a regular button. Keep destructive intent visible and preserve loading, disabled states, form association and keyboard operation. Groups use one Tab stop with arrow-key navigation; view selectors, tabs and menus retain their existing semantics. Page actions sit beside notifications in the app shell top bar without a separate pill shape or per-button shadow.

The application Activity Log groups events by date. Each event uses the same layout: title and right-aligned time, description beneath, then status on the left and an optional Details disclosure on the right. Separate events with subtle horizontal rules. Expandable rows support keyboard activation; the timeline connector runs between the first and last event dots. Clicking anywhere outside the panel dismisses it, as do Escape and the close button. Inside clicks keep it open. Dismissal returns focus to the Activity trigger.

The application details panel starts expanded for each application, with consistent section headings, padding and separators for Resume Judge, ATS keywords, job information, generation settings and notes. A persistent header control collapses the panel into a narrow, light orange rail at the right edge, giving the resume the remaining width. The rail reopens the panel by pointer or keyboard. Collapsing hides the controls from focus while preserving unsaved fields and mounted content. On narrow screens the expanded panel follows the resume; the collapsed rail sits beside it.

Full resume generation opens immediately with a resume-shaped Astryx Skeleton behind a compact centered card that leaves most of the skeleton visible around it: a small animated SVG paper avatar, a compact heading, one Astryx ProgressBar and meaningful changing messages. Do not show a step list or large introductory panel. Show the active job’s reported message. The bar is eased for perceived responsiveness: it starts at 0% and rises quickly to about 70% in the first 15 seconds, then slows and creeps toward a 94% ceiling (about 82% at one minute and 88% at two). It is counted from the job’s reported start so a reload does not restart it, it never moves backwards, and a higher reported percentage raises its target. The displayed value catches up in small steps, so it may briefly lag a new server update. It shows 100% only when the job reports completion. The eased value is visual feedback, not a measurement; do not present it as completed steps, and keep the slow-job notice tied to real progress updates. Rotate short explanations of source grounding, job relevance and review while waiting, without presenting them as completed or current stages. Job posting extraction uses the same treatment immediately, including before its first progress update. Preserve its stop control and recovery flow, and also offer Stop extraction on the processing card, opening the same confirmation as the header control. Keep application details and the app shell unchanged. Resume import shares the treatment but stays indeterminate because it has no granular progress feed. Section or role regeneration keeps the existing workbench mounted and replaces only the target content with unframed Skeleton lines, a slim ProgressBar, the reported status message and cancellation. Keep section navigation, headers, other roles and the supporting column in place; do not add a processing panel above the draft. If the target is unavailable after reconnecting, show compact feedback within the workbench without guessing which content to replace. Include elapsed time for full generation and job extraction, counted from the job's reported start so it survives reloads and navigation, and retain cancellation after the job is active. When a job reports no new progress update for 90 seconds, show a short “This is taking longer than usual” notice, with a stop-and-retry hint wherever cancellation is available, in full generation, job extraction and inline section regeneration; the notice clears when progress resumes and never changes reported progress or status. During full regeneration, keep the existing draft available below the panel with editing locked until processing ends. Announce status changes politely and respect reduced-motion preferences.

---

## 6. Primary User Journey

1. User logs in
2. User lands on the applications dashboard
3. User clicks **New Application**
4. User pastes a job link
5. System creates a draft application and starts async extraction
6. If extraction succeeds, the system runs duplicate detection automatically, considering job posting origin when available, and extracts exact ATS keyword phrases from the job description
7. User resolves any duplicate warning
8. User selects a base resume and generation settings
9. System generates a tailored Markdown resume
10. System computes exact ATS keyword coverage locally; the user may request Resume Judge scoring
11. User reviews, edits, regenerates sections or the full resume as needed
12. User exports the resume as a PDF
13. User may continue editing after export — doing so returns the status to **In Progress**
14. User may toggle the **Applied** flag independently at any point

---

## 7. User-Visible Status Model

Application statuses are kept lightweight and action-oriented for the user.

### 7.1 Primary Statuses

| Status | When It Applies |
|---|---|
| **Draft** | Application exists but no usable tailored resume draft yet. Covers: just submitted URL, extraction pending or running, details extracted but generation not started. |
| **Needs Action** | User must do something before the workflow can continue. Covers: extraction failed (manual entry required), duplicate review unresolved, generation failed, generation timed out, generation cancelled, regeneration failed, export failed. |
| **In Progress** | A tailored resume draft exists and the user is reviewing or iterating. Covers: generation complete, user editing, after section or full regeneration, after editing a previously exported resume. |
| **Complete** | The current draft has been successfully exported as a supported export format (`PDF` or `DOCX`). **Not permanent** — if the user edits or regenerates after export, status returns to In Progress. |

### 7.2 Applied Flag (Secondary)

`applied` is a **separate, user-controlled boolean flag**, not a primary status. It can coexist with any primary status. Examples: `Draft + Applied`, `In Progress + Applied`, `Complete + Applied`.

---

## 8. Internal Processing States

These are not user-facing but must be tracked internally for workflow logic and observability.

**Processing states:**
- `extraction_pending`
- `extracting`
- `manual_entry_required`
- `duplicate_review_required`
- `generation_pending`
- `generating`
- `resume_ready`
- `regenerating_section`
- `regenerating_full`
- `export_in_progress`

**Failure reasons (tracked alongside state):**
- `extraction_failed`
- `generation_failed`
- `generation_timeout`
- `generation_cancelled`
- `regeneration_failed`
- `export_failed`

Internal states must map into the lightweight user-visible statuses in §7. Engineering should maintain this mapping explicitly in code.

---

## 9. Timeout Contract

Async operations must enforce timeouts to prevent silent hangs. These are the required timeout boundaries:

| Operation | Timeout |
|---|---|
| Playwright extraction (URL check, navigation, settle and page read combined) | 30 seconds; the extraction model step has its own 45-second budget, with the primary model capped at 30 seconds so the fallback keeps at least 15 |
| Full resume generation and full regeneration (all sections) | 240 seconds without progress, with a 240 second maximum wall-clock window |
| Single section regeneration | 120 seconds without progress, with a 120 second maximum wall-clock window |
| Resume export | 20 seconds |

On timeout, the operation is treated as a failure and follows the failure handling path defined for that operation. For generation and regeneration, meaningful progress updates from the active job should extend the remaining processing window until the maximum cap is reached, but the workflow must still fail once it stalls past the idle boundary. Engineers may tune these values during implementation, but must have explicit timeouts in place. "Reasonable for MVP" is not sufficient — every async operation must have a defined failure boundary.

---

## 10. Functional Requirements

### 10.1 Applications Dashboard

The landing page shows a list of job applications for the logged-in user.

**Each application card or row must show:**
- Job title
- Company
- Primary visible status (color-coded badge)
- Applied flag (checkbox or badge, user-toggleable inline)
- Job link (clickable)
- Date created
- Date updated
- Selected base resume name
- Attention indicator when action is required
- Duplicate warning indicator if unresolved

**Dashboard capabilities:**
- New Application CTA (prominent)
- Search by company or job title
- Filter by one or more statuses, applied flag, company, and base resume; show result counts and individual/all-filter clearing
- Group applications by status by default, with collapsible headers and counts for the current page. View options can remove grouping or group by company/base resume. Sort by date updated within groups by default, newest first; sortable headers change the row order.
- Delete applications directly from the table
- Stop active extractions directly from the table so stuck rows can be recovered or deleted
- Multi-select applications for bulk delete and bulk mark-as-applied actions
- Current-page selection covers expanded rows only. Collapsing a group preserves existing selections; the bulk bar shows the full selected count.
- Use borderless row action icons, including an applied toggle with an accessible label, pressed state and tooltip. Applied stays independent of primary status.

**UX requirements:**
- Skeleton loading while the list is fetching
- Empty state with a clear CTA if no applications exist
- Attention breadcrumbs/badges where user action is needed

---

### 10.2 Create New Application

**Entry point:** A prominent **New Application** CTA is available on the applications dashboard and opens a modal-based intake flow.

**Default input:** Job application URL.

**Alternate input:** The modal may switch to a pasted job-description path. In that mode, the pasted description is required and the source URL is optional.

**On submit:**
1. Create the application record
2. Set visible status to **Draft**
3. Start async extraction job from the URL by default, from pasted source text plus URL when both are provided, or from pasted source text alone when no source link exists
4. Redirect the user to the new application's detail page immediately after creation
5. Show meaningful loading feedback there (progress messages, skeleton state, and retry or manual-entry recovery when needed)
6. User can still navigate away while the job continues in the background

**Extraction target fields:**
- Job title
- Company
- Full job description
- Compensation text when present
- Job posting origin
- Source URL when provided

**Normalized job posting origin options (MVP):**
- LinkedIn
- Indeed
- Google Jobs
- Glassdoor
- ZipRecruiter
- Monster
- Dice
- Company Website
- Other

Automatic extraction should map known posting domains into these normalized values when confidence is sufficient. If the user selects **Other**, the UI must also collect a short free-text label for the source.

**Extraction implementation:** Use a hybrid extraction pipeline. First capture deterministic page context with Playwright headless browsing, including final URL, page title, meta tags, JSON-LD when present, visible page text, normalized origin from hostname, and recognizable reference-id patterns. Then send that context to an LLM extraction agent through OpenRouter and validate the structured output against a strict schema before accepting it. See §9 for timeout requirements.

**Alternate intake path:** A connected Chrome extension may capture the current tab's URL, page title, meta tags, JSON-LD, and visible page text, then create a new application from that captured content instead of relying on server-side page retrieval first. The extension may create new applications only in MVP; it does not attach captured content to existing applications.

---

### 10.3 Extraction Failure Handling

Extraction failure is a high-priority failure state.

**If the user is still in the creation flow when extraction fails:**
- The application detail page should switch directly into the manual-entry-required recovery state

**If the user has navigated away:**
- Set visible status to **Needs Action**
- Create an in-app notification (`action_required = true`)
- Send an email notification via Resend
- Show a clear CTA on the application card and detail page to complete manual entry

**Manual entry form fields:**
- Job title
- Company
- Job description
- Compensation text (optional)
- Job posting origin (dropdown)
- Other job board / source label (required only when origin is `Other`)
- Notes (optional)

**Retry:** Users must be able to retry extraction from the UI at any point.

**User-stopped extraction:** Users must be able to stop an active extraction from the application detail page and the applications table. A user-stopped extraction should transition to the same recoverable manual-entry state as other extraction failures without creating an action-required notification, so the user can retry extraction, paste source text, complete manual entry, or delete the application.

**Pages without a readable posting:** The extraction model may report that a page is a sign-in wall, a closed or removed posting, or not a job posting at all, instead of inventing a title and description. A sign-in wall follows the blocked-source recovery state. A closed or missing posting follows the standard extraction failure path with `extraction_failure_details.kind` set to `posting_unavailable` or `no_job_posting` and a message that says what was found. The detail page preserves that explanation after reload or navigation.

**Stalled extraction:** If a started extraction reports no progress for 150 seconds, or a queued extraction is not picked up within 300 seconds, the system treats it as failed with `extraction_failure_details.kind = timed_out`. It follows the standard extraction failure path (Needs Action, action-required notification, email). The open detail page learns of this without a reload. Recovery only replaces the progress snapshot it checked; a fresh worker update or retry takes precedence. Late results from the abandoned job are ignored. Stopping or recovering an extraction also cancels the worker job so it frees its slot immediately. Deleting a stalled extraction is allowed and sends no failure notification. It requests worker cancellation and retains a terminal progress fence for up to 24 hours, so a queued job cannot restart work for the deleted application if cancellation is delayed or unavailable.

**Blocked-page handling:** If the captured page is a site block, challenge, or anti-bot notice instead of a real posting:
- Detect the blocked page explicitly before LLM extraction. Block wording counts in the page title, URL or meta tags, or in the body of a short page. A provider name alone, such as a real posting that mentions Cloudflare, does not mark a page blocked.
- Persist sanitized diagnostics only: provider, reference ID such as Ray ID, blocked URL, and detection timestamp
- Transition the application to `manual_entry_required` with `failure_reason = extraction_failed`
- Show a purpose-built recovery state on the detail page

**Recovery order when extraction fails:**
1. Let the user paste job posting text from their browser and retry extraction from that pasted text
2. If that still fails or the user does not have source text, fall back to full manual entry

The blocked-page recovery UI must not persist raw block-page HTML, IP-address text, or challenge payloads.

Automatic extraction counts as successful only when it yields a non-blank `job_title` and `job_description`. `company` may remain blank after extraction; in that case the application proceeds, but duplicate detection is deferred until the user later supplies company information.

If extraction succeeds for the core job details but cannot classify the posting origin confidently, leave the origin blank and allow the user to provide or edit it later from the application detail page.

When the posting clearly states a role location, extraction should also capture optional raw `job_location_text`. `job_location_text` and `compensation_text` should be separated semantically from page context even when they appear on the same line, table row, or paragraph; if either one is ambiguous, leave that field blank rather than using brittle string splitting.

**After manual entry:** Duplicate detection runs automatically.

**ATS keyword extraction and manual keywords:** Whenever a job description is captured, pasted, manually entered, recovered, or later edited, the system should run a cheap structured LLM keyword extraction flow. The extraction should return 8-30 purposeful, high-value exact phrases that already appear in the job description. It should prefer repeated terms, required or preferred qualifications, tools, technologies, credentials, role-title phrases, and core responsibilities. It should exclude generic filler, benefits, legal/EEO language, company boilerplate, and vague soft skills unless clearly role-critical. The backend must deterministically deduplicate and post-filter extracted results so every extracted stored phrase appears in the current job description. Users may add up to 30 manual keyword phrases, capped at 80 characters each; manual keywords persist on the application, do not need to appear in the job description, and participate in deterministic draft coverage and keyword optimization. Existing applications do not require a backfill, and keyword extraction failure must not change visible application status or block resume work.

---

### 10.4 Duplicate Detection

Duplicate detection runs automatically after either:
- Successful automatic extraction, or
- Successful manual job detail entry

If `job_posting_origin` was unknown during the initial duplicate check and the user later saves it before dismissing duplicate review, duplicate detection should run again using the updated origin.

**Matching logic:**
- Run duplicate detection only when the current application has both `job_title` and `company`
- Start with a fuzzy similarity score over normalized `job_title` + `company`
- Boost confidence when normalized `job_posting_origin` matches on both records
- Treat exact job-link matches and exact extracted reference-id matches as high-confidence duplicate signals
- Use materially similar job-description content as an additional confidence signal when available
- Missing origin must not block duplicate evaluation; when origin is unknown on either side, fall back to the other available signals and surface only the fields that actually matched
- Recommended similarity threshold: **≥ 85%** (tunable via config, not hardcoded)
- If extraction succeeds without `company`, skip duplicate review for now and re-run it when the user later saves company information or updates origin before dismissing review

**If overlap is found:**
Show a warning UI (banner or modal) on the application detail page before generation with:
- Similarity score
- Which fields matched
- Link to the existing matching application
- Match basis or confidence context derived from the compared signals

**User options:**
- **Proceed Anyway** — dismisses the warning permanently for this application; duplicate flag is cleared and does not re-evaluate on subsequent regenerations
- **Open Existing Application** — navigates to the matching application

**If no overlap:** Proceed silently to generation setup.

**Status:** While duplicate review is unresolved, visible status is **Needs Action**.

---

### 10.5 Base Resume Selection

A user can maintain multiple base resumes.

- Before generating, the user selects which base resume to use
- Each user may set one base resume as default
- If no base resume is selected at generation time, the default is used automatically
- If no default is set and no selection is made, prompt the user to choose one before proceeding

---

### 10.6 Resume Generation Controls

Before initial generation, the user configures:

| Control | Options |
|---|---|
| Base resume | Dropdown of user's base resumes (default pre-selected) |
| Target length | 1 page / 2 pages / 3 pages |
| Alteration aggressiveness | Low / Medium / High |

**Aggressiveness definitions:**
- **Low:** Light Summary cleanup, light Professional Experience rephrasing or reordering only, no role-title changes, Skills unchanged, and Education unchanged except minimal formatting cleanup
- **Medium:** Rewrite Summary for stronger alignment, make Professional Experience the primary tailoring surface by materially rewriting bullet framing in the first up to 2 source-ordered roles with bullets, explicitly allow merging two related source bullets into one stronger grounded bullet when that improves focus, allow light professional-experience title reframing only when the title stays grounded in the same core role family and seniority, reorder or regroup Skills with the strongest relevant cluster first, allow job-description keyword-skill additions for fit, and keep Education fact-fixed apart from minimal formatting cleanup
- **High:** Strongest rewrite of Summary and Professional Experience for job fit. High may add plausible claims that are not in the source, including technologies, tools, responsibilities, scope, outcomes and metrics, when they are credible for the candidate's demonstrated role, seniority and domain and cite the source bullets they extend. It never invents or changes employers, dates, tenure, institutions, degrees, credentials, certifications, licences, awards or personal information, never raises seniority, and never contradicts the source. The grounding audit in High checks those limits and plausibility rather than source support. Other High behaviour: make Professional Experience the primary tailoring surface by materially rewriting bullet framing in the first up to 2 source-ordered roles with bullets, professional-experience role titles should be actively retitled for target alignment when the new title still matches the demonstrated work and preserves seniority, aggressive regrouping or pruning of Skills with the strongest relevant cluster first, allow broader job-description keyword-skill additions for fit, and Education still fact-fixed apart from minimal formatting cleanup. This mode is an explicit user opt-in and may materially change wording, emphasis, role framing, and keyword coverage, so the generated output must be presented with a clear warning that careful user review is required.

**Settings UI note:** Application details align with the application heading on desktop and use a subtle warm background distinct from the resume. Job information, base resume, target length, additional instructions and notes open as compact read-only values, with a per-field Edit action and a short “Not specified” placeholder when empty. Long text has a three-line preview with an expansion action. Opening or closing an editor does not save or discard changes; job information and generation settings retain their explicit section Save actions, shown when dirty, and notes retain autosave. Aggressiveness uses a three-stop Low/Medium/High slider with full mode descriptions available on hover, keyboard focus and touch. When High is selected, the UI must also show an inline warning that this mode can make substantial changes and should be used only when the user wants a more aggressive rewrite and will review the result carefully.
For medium and high runs, the application detail workspace must preserve an explicit review path for job-description-driven additions that are not explicit in the source resume. In MVP, that review path is the compare workflow, which lets the user inspect the tailored draft beside the generation-time base resume before applying or exporting.

**Length note:** Page count is a content target, not a visual page-fill guarantee. Structured generation enforces hard word caps; source-aware underfill is visible guidance and does not discard a truthful draft or cause padding. Keyword optimization preserves minimal edits, and section regeneration is not judged against a full-draft minimum. Final pagination may vary based on content and formatting. Historical Markdown jobs retain their existing source-aware minimum validation.

---

### 10.7 Resume Generation Pipeline

Generation runs through Pydantic AI and OpenRouter. Initial and full generation batch writable source sections; local validation and bounded targeted repairs preserve valid sections.

**Default supported sections (MVP):**
- Summary
- Professional Experience
- Education
- Skills
- Projects
- Certifications

Custom sections are supported now through the `custom` kind, with user-defined headings, Markdown content and optional entry facts. Stable IDs distinguish repeated sections of the same kind.

**Inputs to generation:**
- Selected reviewed base section document, sanitized to remove personal and contact information before the LLM call
- Job description
- Extracted exact job-description keyword phrases when available, plus the selected aggressiveness coverage target
- Enabled populated sections from the reviewed base resume document
- Stable section and entry IDs, saved document order and section enabled flags
- Page target
- Aggressiveness level
- Any additional user instructions

**Generation requirements:**
- Generate the populated enabled sections in the reviewed source document, in its stored order. Summary is optional; add and review one in the base workbench before tailoring it. Historical Markdown jobs retain their original section-preference behavior.
- Do not generate personal information
- Batch writable sections in an initial writer request; audit rewritten claims against the cited source in a separate structured request. Corrections, fallback and failed-section repairs share an eight-request, 24,000-output-token budget and a 240s full/120s targeted deadline. Fixed-only documents can be assembled locally.
- Section and role regeneration target only the selected source-backed content. Fixed Education, Certifications, low-mode Skills and opaque Experience are edited directly. Whole-section regeneration is unavailable when it would replace draft-only entries; add those facts to the base and fully regenerate first.
- Professional Experience must use deterministic source anchors (`title`, `company`, `date_range`, source order) extracted from the sanitized base resume
- Professional Experience role order must stay fixed to the source anchors; reprioritization happens by changing bullet emphasis inside each anchored role
- Professional Experience prose is returned with stable entry/bullet source references. Education and immutable entry facts are copied locally; deterministic entry blocks drive the workbench, validation and export. Ambiguous reviewed Experience remains preserved Markdown until the user structures it.
- Professional Experience row 1 = `company | location`, row 2 = `role title | date range`
- Education row 1 = `school | location`, row 2 = `degree/program | graduation date`
- In both sections, the left fields are left-aligned and the right fields are right-aligned in preview, PDF, and DOCX
- Low aggressiveness must keep Professional Experience titles source-exact
- Medium may lightly reframe Professional Experience titles only when the new title stays grounded in the same core role family and seniority as the source title
- High should actively attempt target-aligned Professional Experience retitles when the new title still matches the demonstrated work and preserves seniority; leave the source title unchanged when no truthful adjacent title is supported
- Low and Medium may use truthful job-description phrasing for role fit, but must fail closed on unsupported technologies, skills, employers, dates, institutions, credentials, awards, scope or outcomes. High may add plausible technologies, skills, scope, outcomes and metrics for job fit, and must fail closed on invented or changed employers, dates, tenure, institutions, credentials, awards or seniority, contradictions of the source, and implausible claims. Keyword optimization keeps the strict Low/Medium rule at every level.
- When ATS keywords are available, generation should prefer exact keyword phrasing where truthful and natural. Coverage targets are minimum goals only: Low 45%, Medium 65%, High 80%. There is no upper limit, and missing the target is a warn-only visibility metric, not a validation failure or repair trigger. Targeted keyword optimization uses the shared Tier 2 model pair to minimally edit the current draft for missing keywords while preserving already matched phrases and grounding rules. It must keep the previous draft if the optimized candidate lowers the matched keyword count or drops an already matched keyword phrase.
- When Professional Experience is enabled, medium and high must visibly tailor it instead of leaving the first up to 2 roles with bullets effectively source-identical while spending nearly all rewrite effort on Summary or Skills
- Company and date range for every Professional Experience role are deterministic invariants and must remain source-exact for all aggressiveness levels
- Education bullets are optional and allowed only for grounded details already present in the source material
- Apply a deterministic post-LLM rendering pass that rehydrates Professional Experience company, optional location, and date values from anchors before validation or assembly; low also rehydrates source-exact titles while medium and high preserve the generated title for validation
- Generated-draft preview, PDF export, and DOCX export must consume the same semantic render model derived from normalized Markdown, rather than separate format-specific line guessing
- The model returns a typed section envelope with stable `id`, `paragraph`, `source_ids`, and `entries` containing stable entry IDs, optional permitted role title and bullets with source references. The provider receives the nested rewrite structure, or the distinct minimal keyword-patch structure for keyword optimization. Transport profiles may omit unsupported JSON Schema constraints; strict local models and section validators enforce the complete acceptance contract. Headings and frozen factual fields are copied locally. Per-section schemas reject extra keys; the outer batch preserves individually valid siblings for targeted repair. HTML, tables, images and code fences are invalid.
- Prompt variants must explicitly reflect the selected page target and aggressiveness level
- Every LLM system prompt that authors prose must include the shared Unslop instruction verbatim. Job posting extraction, ATS keyword extraction, resume cleanup and nested entry extraction copy source text exactly, and the grounding claim audit returns decisions and issue codes only, so those prompts omit it. Operation-specific grounding, privacy, exact-copy, ATS, structured-output, and resume rules take precedence when they conflict with general writing guidance.
- Additional requests cover the required claim audit, provider failure, typed output correction and targeted repair, within the shared deadline and usage budget.
- Final persisted draft output remains Markdown, but Markdown is rendered locally from the semantic JSON object rather than authored directly by the LLM
- Model called via OpenRouter; models come from the operation-based Tier 1/Tier 2 configuration (see §3.1)

**ATS guidance for generation prompts:**
- Standard, recognizable section headings
- Simple single-column structure
- No tables
- No images
- Clean bullet formatting
- Human-sounding output with explicit anti-filler guidance, varied bullet structure, and candidate-specific detail requirements
- Explicit examples for high aggressiveness that separate plausible job-fit additions (outcomes, metrics, tools) from claims that are never allowed (employers, credentials, dates, unrealistic scale)
- Strong keyword relevance to the job description
- Source-based content at Low and Medium; plausible job-fit additions only at High; no invented credentials or history at any level
- No personal or contact information in the model prompt or output contract

---

### 10.8 AI Validation Layer

After generation returns structured JSON, the application validates shape, identity, provenance, immutable facts, privacy and ATS structure locally. A bounded semantic audit checks rewritten claims against their source. Both gates fail closed; schema validity alone is insufficient evidence of factual support.

**Validation must check for:**
- Strict JSON parsing and schema compliance
- Section-specific semantic content schemas, including nested jobs, education entries, skill categories, projects, certifications, and bullet arrays
- ATS-safe structure (no tables, no columns, no special characters)
- Valid Markdown formatting
- Hallucinated factual content not present in the base resume — specifically: invented employers, dates, credentials, educational institutions, awards, or outcomes, plus invented job titles outside the medium and high professional-experience title-rewrite allowances
- Professional Experience and Education retain source entry identity and order, source-exact company/institution/qualification and optional date/location fields. Low preserves titles; permitted title reframing must remain grounded. Dates may be absent when absent in reviewed source. Structured Experience requires company/title, and structured Education requires institution/qualification before generation.
- A medium/high tailoring quality check for the first up to 2 source-ordered roles; lack of visible tailoring is guidance while unsupported factual output still fails closed
- Document the limits of heuristics and model-based claim auditing. Neither proves semantic truth; representative live evaluations and user review remain necessary.
- Consistency across sections (no conflicting dates, duplicate entries)
- All eligible sections are present and in the correct order, and sections absent from the source resume are not expected even if enabled in user preferences
- Personal or contact information leakage in generated sections
- Valid stable source references grounded in the source snapshot
- Content is appropriate for the target page length. Hard word caps remain validation limits; source-aware underfill and tailoring quality are surfaced as guidance, rather than discarding safe sections

**Validation outputs:**
- **Approve** — content passes; proceed to assembly
- **Fail** — content is not acceptable; generation fails

**Minimum failure conditions (not left to engineer judgment):**
- Hallucinated credentials not found anywhere in the base resume
- Missing one or more eligible sections
- Sections in the wrong order
- Invalid JSON or schema output
- Markdown-string generation payloads where semantic JSON content is required
- Any generated personal or contact information

**On validation failure:**
- Visible status becomes **Needs Action**
- Internal failure reason recorded as `generation_failed`
- In-app notification created
- Email sent (high-signal failure)

---

### 10.9 Resume Assembly

After successful validation, the system assembles the final resume draft in Markdown.

**Assembly order:**
1. Inject user personal information header (name, email, phone, location text, and LinkedIn URL — from user profile, not LLM)
2. Insert eligible generated sections in the user's preferred order
3. Save the assembled Markdown to `resume_drafts`
4. Set visible status to **In Progress**
5. Send email notification: "Your resume for [Job Title] at [Company] has been generated"
6. Create in-app notification

---

### 10.10 Application Detail Page

The main working page for a single application.

**Job information area:**
- Job title
- Company
- Job posting origin (editable dropdown; when `Other` is selected, require a short free-text label)
- Primary status badge
- Applied toggle
- Job URL (clickable)
- Job description (expandable/collapsible)
- Notes (free text, auto-saved)

**Resume workspace:**
- One section workbench with inline Markdown prose and structured entry editing, include/order controls, flexible custom sections and required instructions for regeneration
- Contact card uses profile data; upload suggestions are local and require user review
- Comparison groups changes by stable section/entry IDs and bullet provenance against the source snapshot. Legacy drafts show an explicit limited-comparison notice.
- **Application controls:** Place Activity and Actions in an Astryx ButtonGroup beside the application title, with the delete/stop control separate. Group section Edit/Preview, Include and ordering buttons; Include is a pressed-state toggle. Keep comparison section navigation in the same toolbar row as highlighting/layout controls, and use the page-level actions for closing comparison and export. The details column uses a faint warm orange background and thin orange scrollbar to separate it from the resume paper.
- **Desktop layout:** Put the resume workbench on the left and Resume Judge, ATS Keywords, Job Description, Generation Settings and Notes on the right, in that order. Keep the resume tabs and save controls outside the selected panel’s scroll area. Bound the supporting column separately so its cards remain reachable without moving resume navigation. Stack the resume before supporting cards at narrower widths; comparison uses the full workspace width.
- **Resume Judge card:** A dedicated right-column review card sits above the job description once a draft exists. It owns all judge states, including pending, queued, stale, failed, and scored results, and opens the full breakdown when review details are available.
- **Resume Judge breakdown:** Shows exact score, verdict, weighted dimension notes, evaluator notes, and regeneration instructions. Judge failure or stale score must not block editing or export.
- **Stale judge behavior:** If the user edits the draft after scoring, the previous score may stay visible but must be marked stale and offer manual re-evaluation instead of pretending it still matches the latest draft.
- **ATS Keywords panel and modal:** A compact right-column panel near Resume Judge and Job Description opens an ATS keyword breakdown modal. The card shows total keywords, extraction state, and, once a draft exists, matched count, total count, percentage, target percentage, and target-met state. The modal shows extracted/manual keyword phrases with matched or missing state, supports adding and removing manual keywords, and offers `Optimize for missing keywords` when a ready draft has missing keywords. Matching is deterministic, case-insensitive, and exact against the stored phrase only; synonyms, fuzzy matches, plural variants, punctuation variants, stemming, and reordered words must not count.

**Action buttons:**
- Delete Application
- Generate Resume (pre-generation only)
- Regenerate Section
- Regenerate Full Resume
- Retry Extraction (if extraction failed)
- Export PDF / DOCX
- Re-evaluate Resume Judge for stale edited drafts

---

### 10.11 Section Regeneration

**Flow:**
1. User selects a section or experience entry from the workbench
2. User provides specific regeneration instructions (**required — cannot be blank**)
3. System uses Pydantic AI with sanitized current section context + immutable source snapshot + job description + user instructions + aggressiveness level + target length, with bounded output correction and targeted repair
4. Deterministic validation reviews the regenerated section output
5. Section is updated in the versioned document and its deterministic Markdown projection; unrequested sections and entries are preserved
6. Visible status remains **In Progress**

**On failure:**
- Visible status becomes **Needs Action**
- Internal failure reason: `regeneration_failed`
- In-app notification created

---

### 10.12 Full Regeneration

**Flow:**
1. User opens full regeneration
2. Existing generation settings are pre-filled
3. User may update page length, aggressiveness and additional instructions. Default regeneration keeps the saved draft structure and frozen source. The explicit `Use latest base resume` option replaces content/layout and refreshes source links on success.
4. System enforces the user's monthly subscription quota before queueing regeneration
5. Full batched generation pipeline reruns (§10.7 → §10.8 → §10.9)
6. Latest draft is replaced on success; failures preserve its previous content. Default regeneration retains fixed, draft-only and structurally edited sections locally.

When the subscription quota is reached, the API returns a sanitized `quota_exhausted` response with user-safe guidance to contact an administrator or upgrade the subscription tier.

**Draft versioning:** Each full regeneration overwrites the current draft. No resume version history UI is required for MVP. The `last_generated_at` timestamp on `resume_drafts` should be updated.

---

### 10.13 Manual Editing

Users can edit section Markdown and structured entries in one workbench when generation is idle. Saves use revision checks to reject stale writes.

- Saving persists the versioned document, its deterministic `resume_drafts.content_md` projection and enabled-ID snapshot under an owner/revision fence
- Editing after export changes visible status from **Complete** back to **In Progress**
- This same status rollback applies after any regeneration

---

### 10.14 Resume Export

**Trigger:** User clicks **Export PDF** or **Export DOCX**

**Process:**
1. Render the latest saved draft document at request time, respecting inclusion and order. Legacy drafts use their saved `content_md`. No cached or persistent PDF is used.
2. Inject user personal information if not already present
3. Convert Markdown into the requested output format using the committed renderer for that format
4. Stream the file directly to the browser as a download
5. **Do not store exported files in persistent storage for MVP** — they are always regenerated on demand from the latest draft

**Filename format:** `{full_name}_resume_{YYYYMMDD_HHMMSS}.{ext}`

**Output requirements:**
- Two ATS-safe formats only: PDF and DOCX
- Clean, industry-standard single-column layout
- No tables, no images, no decorative elements
- Standard fonts (e.g., Georgia, Calibri, or equivalent)
- Margins: 0.75–1 inch
- Section headings as bold text with visibly larger size than body copy
- Sections in the saved resume document order, respecting its enabled flags
- Professional Experience and Education must use the same deterministic two-row layout as preview:
  - row 1 left-aligned organization/school
  - row 1 right-aligned location when available
  - row 2 left-aligned role/degree
  - row 2 right-aligned duration or graduation date when available
  - bullets below the two-row header
- PDF and DOCX must be rendered from the same semantic resume model so field placement stays consistent across formats
- Body text should be slightly smaller than structured entry headers, with increased spacing between sections and between adjacent experience/education entries for readability
- DOCX uses Word-native formatting with Letter page size and best-effort spacing aligned to the saved page-length target; exact pagination parity with PDF is not required

**On success:**
- Visible status → **Complete**
- `resume_drafts.last_exported_at` updated
- In-app notification created

**On failure:**
- Visible status → **Needs Action**
- Internal failure reason: `export_failed`
- In-app notification created
- Email notification sent (high-signal failure)

---

### 10.15 Base Resume Management

**Resume library:**
- Use the Astryx documentation template’s responsive grid of clickable cards, with a subtle custom SVG document illustration, a prominent resume name and starred Default badge, an excerpt from the saved Summary section, and secondary created/updated dates. Dates remain plain text with separate labels. Right-align the icon-only Edit and Delete controls, retaining accessible names and tooltips. The illustration is decorative and does not claim the original file format. Show “No summary added yet.” when no Summary section exists.
- Keep name search visible when there are no matching results, with a clear action to restore the collection.
- Clicking a card or activating its link with the keyboard opens that resume’s details/workbench. Keep Edit, Delete and Set Default as independent controls inside each card; these controls must not trigger card navigation. Delete retains confirmation and recoverable error feedback.

**Supported creation methods:**

**Method A — File upload:**
- User uploads an existing `.docx` or `.pdf` resume file
- The initial PDF upload page uses the full available width with a single drop zone that also opens the file picker, a resume name, an AI extraction checkbox and a submit action. Use the page heading only, without content cards, a secondary heading or a review-preview column. Accept one PDF at a time; invalid drops retain any previously selected PDF. During import, keep controls disabled and show explanatory progress below the form without a card. Retain the selected file/name after recoverable failures and explain the local-only path when AI entry extraction is opted out. Upload has no granular server progress feed, so show indeterminate activity without claiming a current/completed stage or percentage.
- Backend parses the file (`python-docx`, `pdfplumber`, or equivalent) and converts to Markdown
- Parse sections locally, classify with Jev, and use Tier 2 extraction by default for every populated Experience/Education section; preserve source text on failure. Users may explicitly opt out of AI entry extraction.
- User reviews section classifications and extracted entry facts in the workbench before generation

**Review workbench:**
- Contact information uses the same section heading, body typography and header action layout as other sections in both workbenches. Profile remains the source of contact details, with an Edit profile link. Imported suggestions stay separate and require profile review before use.
- Base and application workbenches open with read-only section previews. An accessible Edit button on each section, or double-clicking its preview, opens only that section for editing. Returning to Preview does not save or mark facts reviewed.
- Both source and generated resumes use real tabs with one visible content panel. Contact information is first, followed by sections in saved document order. Imported original text has a distinct Extracted text tab. Keep unsaved edits when switching tabs or editors; switching returns the selected section to preview.
- Put the workbench directly below the resume name and any banners, using the full available page width. Keep tabs at the top of a sticky desktop left rail and above content at narrower widths. On sufficiently tall desktop screens, fit the workspace to the viewport and scroll only the active tab’s content; growing text editors do not add another scrollbar. Retain page flow on narrow or short screens so navigation and controls remain reachable. Section type controls are secondary settings; inclusion and ordering remain available in the workbench.
- Keep review progress and an accessible sticky save action available across desktop, tablet and phone widths without a reserved bottom gap. Saving and marking facts reviewed are separate actions.
- Preserve original extracted text for import checks. Recognizable consecutive job headers must become separate entries even without PDF paragraph spacing. Tier 2 receives numbered source lines and returns separate role spans, explicit company/title/location/date fields, and spans for each duty bullet. This includes repeated employers, promotions, internships, headers without Markdown separators, wrapped duties and single-year education dates. The app copies duties locally, validates contiguous entry coverage, exact facts within each entry header, separate bullet coverage and dated-entry order, and assigns stable IDs locally. Missing locations or dates remain blank. Unclear or suspicious partial parses remain source text; failed assistance keeps the source editable and unreviewed.

**Method B — Structured form:**
Integrated section workbench collecting:
- Summary
- Work experience (company, title, dates, bullet points — repeatable)
- Education (institution, degree, dates — repeatable)
- Skills
- Additional sections (optional, MVP scope TBD)

On submit, the backend validates the versioned document and renders its Markdown projection.

**Management capabilities:**
- Create base resume with a name unique within the authenticated user’s account, ignoring case and surrounding spaces. Reject duplicate uploads, creates and renames with recoverable feedback. Use the saved name in the workbench header and breadcrumb. Edit the name inline in the header through a labeled field, using the same save action as section edits; do not repeat a name field below the import banner. Escape cancels a saved resume’s pending rename without discarding section edits. The initial upload form still collects a name.
- Edit base resume (section workbench)
- Delete base resume (with warning if referenced by any application)
- Set one as default

---

### 10.16 User Profile and Preferences

**Personal information:**
- Name
- Email (read-only; from Supabase Auth)
- Phone number
- Address

**Resume structure:** Section inclusion and ordering belong in each resume workbench, including custom sections. Profile keeps personal information and general account preferences. Historical Profile section fields remain stored for compatibility and do not control structured generation.

**Base behavior:** The saved, reviewed base document controls inclusion and order for initial generation. Changing it does not change existing drafts or their source snapshots. Legacy base Markdown must be reviewed and saved before generation. No automatic migration applies old Profile choices to base documents.

**Draft behavior:** Save inclusion and order in the generated resume workbench. Exclusion retains content and stable nested IDs for recovery. Saving changes updates exports and comparison immediately. Comparison includes frozen source content for re-included sections without changing the stored snapshot. Subsequent regeneration uses the saved draft structure. Full regeneration uses the frozen source snapshot, keeps headings and order, and rewrites only reviewed source-backed sections. Fixed sections, draft-only sections, changed section types and sections whose entry IDs/order differ from the source keep their current content. Section/entry regeneration and keyword optimization also use the frozen source; re-included source sections require reviewed source content.

**Source refresh:** Full regeneration offers an explicit `Use latest base resume` option. It replaces content and structure from the linked, reviewed base and records a fresh source snapshot only on success. This is required to adopt legacy drafts without source links or to tailor newly added base content. The default never fabricates historical links from the current base. Failures preserve the existing draft, and legacy drafts remain editable/exportable.

**Default base resume:** Selectable from the user's base resumes.

---

### 10.17 Notifications

**In-app notifications** are used broadly for workflow awareness and stored in the `notifications` table.

The top-bar notification bell opens a scrollable newest-first inbox dropdown. Notifications linked to an application must take the user directly to that application workspace when selected. Users can clear non-attention notifications from that dropdown, while action-required notifications stay visible until the underlying issue is resolved.

Examples:
- Extraction started
- Extraction succeeded
- Duplicate detected
- Resume generated
- Section regenerated
- Full resume regenerated
- Export completed
- Extraction failed *(action_required = true)*
- Generation failed *(action_required = true)*
- Export failed *(action_required = true)*

**Attention indicators:** Applications with unresolved `action_required` notifications must show a visible badge on both the dashboard card and the detail page.

**Email notifications (via Resend)** are reserved for high-signal events only:

| Event | Email Sent |
|---|---|
| Extraction failed — manual entry required | ✅ |
| Resume generation completed | ✅ |
| Resume generation failed | ✅ |
| Resume export failed | ✅ |

All emails must include a direct link to the relevant application.

---

### 10.18 Invite Onboarding

- Admin can create a new invite from an admin users screen by entering email (first and last name optional).
- Invite creation immediately:
  - creates or reuses a Supabase Auth user
  - creates a pending invite record with expiry
  - revokes previous pending invites for that user
  - sends a branded invite email through Resend with a signup link
- Signup page behavior:
  - loads invite metadata from token preview
  - locks email to the invited address
  - requires first name, last name, location, phone, email, password, and password confirmation
  - treats LinkedIn as optional
  - rejects mismatched or weak passwords
- Accepting invite:
  - validates token status and expiry
  - validates invited email match
  - sets the account password
  - marks onboarding complete on profile
  - marks invite as accepted
  - signs the user in and redirects to the authenticated app shell

### 10.19 Public Landing and Access Requests

- Visiting the root domain shows a public Applix landing page before authentication.
- Top navigation is limited to Features, Pricing, Login, and Sign up.
- The landing page must make the app's beta and invite-only status clear.
- Features copy must describe the committed product behavior without promising unsupported automation or public signup.
- Pricing is informational only during beta:
  - Standard: $10/month, $96/year, 50 generations per month
  - Pro: $30/month, $288/year, 200 generations per month
  - Pro copy may describe better model routing or higher-capability models but must not name exact models
- Pricing CTAs and public Sign up route submit an early-access request only.
- Access request submission sends a sanitized email to configured admins through Resend.
- Access request submission validates deliverable-looking email addresses, rate-limits repeated client submissions, and suppresses short-window duplicate requests for the same email.
- Access requests fail closed when admin recipients or email delivery are not configured.
- Admin approval remains manual through the existing admin invite flow.

### 10.20 Admin Persona and Surfaces

Admin has three product responsibilities in MVP:

1. Metrics dashboard
2. User management
3. Subscription tier settings

**Admin metrics dashboard must show meaningful usage metrics only:**

- total users, active users, deactivated users, invited (not yet onboarded) users
- invites sent, accepted, pending
- total applications
- workflow operation totals and success/failure rates for extraction, generation, regeneration, and export

**Admin user management page must support:**

- list users with search and status filters (active, invited, deactivated)
- invite new users (triggering Resend email)
- edit user profile fields (email, first name, last name, location, phone, LinkedIn)
- view and edit each user's subscription tier
- deactivate/reactivate users
- delete users

**Admin subscription settings page must support:**

- view Basic and Pro tier settings
- edit each tier's monthly resume-writing quota
- reject negative, fractional or excessive monthly limits
- show that Basic and Pro use the same models; do not expose model or reasoning selectors

---

## 11. Data Model (Logical)

### `users` / `profiles`
| Field | Type | Notes |
|---|---|---|
| id | UUID | Supabase auth user ID |
| email | string | Read-only from auth |
| first_name | string | nullable; required during invite signup completion |
| last_name | string | nullable; required during invite signup completion |
| name | string | |
| phone | string | |
| address | string | Stored as the user's short location text for resume assembly/export |
| linkedin_url | string | nullable; optional LinkedIn URL for resume assembly/export |
| is_admin | boolean | default false |
| is_active | boolean | default true; false blocks application access |
| onboarding_completed_at | timestamp | nullable; set after invite signup completion |
| subscription_tier | string | `basic` or `pro`; default `basic`; controls monthly writing-request allowance only |
| default_base_resume_id | UUID FK | nullable |
| section_preferences | JSONB | Map of section_id → enabled boolean |
| section_order | JSONB | Ordered array of section identifiers |
| extension_token_hash | string | nullable; server-side only; stores the scoped Chrome extension token hash |
| extension_token_created_at | timestamp | nullable |
| extension_token_last_used_at | timestamp | nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

### `base_resumes`
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| user_id | UUID FK | |
| name | string | User-defined label |
| content_md | text | Full resume in Markdown |
| is_default | boolean | Only one per user |
| created_at | timestamp | |
| updated_at | timestamp | |

### `applications`
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| user_id | UUID FK | |
| job_url | string | nullable; source URL when provided |
| job_title | string | Extracted or manually entered |
| company | string | Extracted or manually entered |
| job_description | text | Extracted or manually entered full primary posting body, including qualifications and other role sections when available |
| job_keywords | JSONB | nullable; latest ATS keyword extraction lifecycle state, source hash, model, timestamps, and ordered exact keyword phrases with `source` set to `extracted` or `manual` |
| job_location_text | text | nullable; raw location or hiring-region snippet copied from the posting or manual entry when available |
| compensation_text | text | nullable; raw salary or compensation snippet copied from the posting or manual entry when available |
| extracted_reference_id | string | nullable; persisted extracted requisition or reference ID when available |
| job_posting_origin | enum | Normalized posting source; extracted when possible and user-editable later. `linkedin`, `indeed`, `google_jobs`, `glassdoor`, `ziprecruiter`, `monster`, `dice`, `company_website`, `other`; nullable |
| job_posting_origin_other_text | string | nullable; required when `job_posting_origin = other` |
| base_resume_id | UUID FK | Base resume used for generation |
| visible_status | enum | `draft`, `needs_action`, `in_progress`, `complete` |
| internal_state | enum | See §8 |
| failure_reason | enum | See §8; nullable |
| extraction_failure_details | JSONB | nullable; sanitized recoverable extraction diagnostics (`blocked_source`, `user_cancelled`, `callback_delivery_failed`, `timed_out`, `posting_unavailable`, `no_job_posting`) |
| resume_judge_result | JSONB | nullable; latest Resume Judge lifecycle state, score breakdown, and stale-draft metadata |
| applied | boolean | User-controlled flag |
| duplicate_similarity_score | float | nullable |
| duplicate_match_fields | JSONB | nullable |
| duplicate_resolution_status | enum | `pending`, `dismissed`, `redirected`; nullable |
| notes | text | nullable |
| full_regeneration_count | integer | non-null, default 0; legacy counter retained for compatibility; subscription quota now controls generation limits |
| exported_at | timestamp | nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

### `resume_drafts`
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| application_id | UUID FK | |
| user_id | UUID FK | |
| content_md | text | Latest assembled resume in Markdown |
| generation_params | JSONB | `{ page_length, aggressiveness, additional_instructions }` plus safe generation metadata such as `subscription_tier`, `quota_period_start`, and `model_used`; hidden queue-only model override keys must not be persisted |
| sections_snapshot | JSONB | Enabled sections and order at time of generation |
| last_generated_at | timestamp | |
| last_exported_at | timestamp | nullable |
| updated_at | timestamp | |

### `notifications`
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| user_id | UUID FK | |
| application_id | UUID FK | nullable |
| type | enum | `info`, `success`, `warning`, `error` |
| message | text | |
| action_required | boolean | Drives dashboard/card attention indicators |
| read | boolean | |
| created_at | timestamp | |

### `user_invites`
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| invitee_user_id | UUID FK | Invited user in auth |
| invited_by_user_id | UUID FK | Admin inviter |
| invited_email | string | Normalized invited email |
| token_hash | string | Stored hash only; invite token is never stored plaintext |
| status | enum | `pending`, `accepted`, `revoked`, `expired` |
| expires_at | timestamp | |
| sent_at | timestamp | |
| accepted_at | timestamp | nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

### `usage_events`
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| user_id | UUID FK | Event owner |
| application_id | UUID FK | nullable |
| event_type | string | e.g. extraction, generation, regeneration, export, invite lifecycle |
| event_status | enum | `success`, `failure`, `info` |
| metadata | JSONB | Sanitized event context |
| created_at | timestamp | |

### `subscription_tiers`
| Field | Type | Notes |
|---|---|---|
| key | string | `basic` or `pro` |
| name | string | Display label |
| monthly_resume_generation_limit | integer | Monthly UTC quota for initial generation, full regeneration, and section regeneration; must be non-negative and bounded by backend validation |
| generation_model | string | OpenRouter primary model ID for the tier; must be one of the curated admin model options |
| generation_reasoning_effort | string | OpenRouter reasoning effort for the primary model; model-aware allowed values are `none`, `low`, `medium`, `high`, and model-specific `xhigh` |
| generation_fallback_model | string | OpenRouter fallback model ID for the tier; must differ from primary and be one of the curated admin model options |
| generation_fallback_reasoning_effort | string | OpenRouter reasoning effort for the fallback model with the same compatibility rules |
| is_active | boolean | Active tiers can reserve generation quota |
| created_at | timestamp | |
| updated_at | timestamp | |

### `resume_generation_usage`
| Field | Type | Notes |
|---|---|---|
| user_id | UUID FK | User whose quota is counted |
| period_start | date | First day of the UTC calendar month |
| generation_count | integer | Reserved resume-writing jobs for the user in the period |
| created_at | timestamp | |
| updated_at | timestamp | |

---

## 12. UX Requirements

Application and admin-user tables follow the Astryx `table-filter` template with compact filter chips, flat divided rows, status pills, sortable headers, collapsible grouping, column visibility and density controls. Tables retain pagination and horizontal scrolling on narrow screens so all actions remain reachable. Saved views capture search, filters, grouping, columns, density and sorting for the current mounted page session; leaving or reloading the page clears them. Admin user filters preserve the server-side active/invited/deactivated contract and add client-side tier filtering.

Authenticated routes, including admin, use one shared Astryx neutral theme. Tables, buttons, sections, menus, filters and form controls use shared adapters and semantic tokens. Use flat sections with spacing and dividers for page regions, forms, metrics and lists; keep a distinct resume paper surface and raised overlays. Avoid nested card frames. Follow Astryx shell, searchable table, dashboard, settings and editor templates. Preserve screen content and actions while allowing orientation changes that improve reading and use. Profile uses the Astryx settings template across the full available page width with description/form columns and stacked fields on narrow screens, without a separate section rail or tabs; resume libraries use the documentation template’s clickable card grid; authenticated typography uses shared Heading/Text styles. Native form validation, field types, refs and Markdown editing contracts remain intact. The marketing page keeps its public design. Login, access-request and invite-setup pages share one auth layout. An illustration panel on the left shows only the Applix logo. The form on the right has a short heading, all feedback directly under it, a divider, then the fields.

The shared top bar provides navigation context. Profile is a standalone sidebar destination for every authenticated user and opens that user's own profile at `/app/profile`. Page-level actions appear in the app shell top bar immediately beside notifications. Retain accessible headings without adding duplicate body titles; individual application and resume editor pages keep their existing body headings. Related actions use a button group; lone actions remain regular buttons. Header actions wrap on narrow screens. Keep section-specific controls beside their content. Source resume naming and save/upload controls remain associated with their native forms. Page actions do not float over content or reserve a bottom action strip.

Use the Astryx neutral theme and its standard primary and secondary CTA button styles, with page actions beside notifications in the app shell top bar. Destructive actions retain error styling. Selection dropdowns and account/application action menus use Astryx DropdownMenu, with native select backing fields for form validation, form data and refs. Preserve keyboard navigation, disabled choices, dismissal and focus restoration. Informational popovers and the notifications dialog retain their existing roles. The dashboard Activity chart shows applications created per local day for the last 7 days, 30 days (default) or 3 months, and per Monday-start week for the last 12 months. Each bar stacks the applications that are currently marked applied under those not yet applied, with a matching legend, per-bar tooltip and a screen-reader table. A segmented range control refetches only the selected window from the server; the previous chart stays visible, dimmed, while the next range loads, and a failed load offers retry without hiding the rest of the dashboard. Job sources use a thin donut with the total in its center and labeled count/percentage rows; status breakdown shows one figure per status with its badge and share; top companies are a ranked list with initials avatars and count badges. These three panels share one section separated by hairline dividers, side by side on wide screens and stacked when narrow. Admin Metrics shows headline totals, user and invite donuts, and one success/failure row per workflow operation; an operation with no runs reads "No runs" instead of a 0% rate.

- **Skeleton loading** on all async data fetches
- **Step-by-step progress messages** during extraction and generation (not just a spinner)
- **Success and error toasts** for transient feedback
- **Action-required banners** on detail pages when user input is needed
- **Dashboard attention badges** on cards with unresolved actions
- **Empty states** with clear CTAs
- **Optimistic UI** where safe (e.g., toggling the applied flag)
- **Intuitive mode switching** between resume preview and Markdown edit modes

---

## 13. Non-Functional Requirements

| Requirement | Detail |
|---|---|
| Data isolation | Per-user RLS enforced on all Supabase tables |
| API security | Application routes require a valid backend-issued RS256 JWT; only explicitly documented login, invite, access-request, health, and authenticated service callback surfaces may be public or credentialed separately. Shared Redis rate limits protect all API routes, with stricter limits for authentication, invite, upload, extension, and expensive generation/export operations. |
| Async processing | Extraction and generation must run as background jobs |
| Timeouts | See §9 for required timeout boundaries per operation |
| Logging | Structured logging required on all background jobs, LLM calls, and export operations |
| AI tracing | LangSmith tracing covers every external AI task, including Jev import classification, nested entry extraction and live fictional evaluations. Configured local and production runs use selectable projects, initially applix-dev and applix-prod; unconfigured installations default off. Enabled tracing requires an explicit project and API key, plus a workspace ID when required by the LangSmith key scope, records workflow roots and nested attempts using counts, usage and safe metadata (including the output mode, temperature, token cap and reasoning mode actually sent), publishes model identity and available token counts in LangSmith-native fields, and by default excludes private resume/job bodies. An explicit `LANGSMITH_TRACE_CONTENT` opt-in, which the owner enables in local and production, adds redacted prompt messages and parsed outputs to model runs only; contact details pass through the redactor, and profile personal information is never sent to the model. User/profile records, credentials, callbacks and raw exception/provider payloads stay excluded in every mode. Telemetry outages do not change workflow outcomes. |
| Failure recovery | All failure states must be recoverable by the user (retry, manual entry, regenerate) |
| PDF freshness | PDF is always generated from the latest `content_md` at export time; no cached PDFs |

---

## 14. Out of Scope for MVP

- Multiple PDF templates or user-selectable output formats
- Cover letter generation
- Public sign-up
- Collaborative or team workflows
- Persistent PDF storage
- Side-by-side duplicate comparison
- Advanced analytics or reporting
- Resume version history UI
- LinkedIn or job board integrations beyond URL scraping

---

## 15. Engineering Decisions Still Needed

These are implementation decisions, not product decisions:

| Decision | Notes |
|---|---|
| Background job strategy | `FastAPI BackgroundTasks` vs. ARQ vs. Celery+Redis; consider job persistence across Railway restarts |
| Real-time progress delivery | Use per-application SSE for live detail-page workflow updates, with 5-second polling retained as a watchdog/reconnect fallback |
| Playwright on Railway | Confirm headless Chromium runs in Railway containers; may require custom Dockerfile with system deps |
| PDF rendering engine | WeasyPrint vs. Playwright print-to-PDF; validate ATS output quality |
| Fuzzy match threshold | Default 85% recommended; must be environment-configurable, not hardcoded |
| Markdown rendering library | React Markdown or equivalent for preview mode |
| Resume file ingestion | Validate `python-docx` + `pdfplumber` output quality; evaluate optional LLM cleanup pass |
| OpenRouter model compatibility | Validate Pydantic AI structured-output compatibility with OpenRouter for tier-configured primary and fallback model IDs |

---

## 16. Acceptance Criteria

The MVP is successful if a user can:

- [ ] Log in to an invite-only app with email and password
- [ ] Admin can invite a user by email and trigger a Resend invite email
- [ ] Invite link opens signup page with locked invited email and required onboarding fields
- [ ] Invite signup enforces password confirmation and password complexity rules
- [ ] Invite acceptance completes profile onboarding and signs the user in
- [ ] Create a new application from a job link
- [ ] Create a new application from a connected Chrome current-tab capture
- [ ] Receive automatic extraction or be routed to manual entry on failure
- [ ] See blocked-source recovery with provider, reference ID, blocked URL, and pasted-text retry before manual entry
- [ ] See job posting origin auto-populated when it can be extracted and supply or edit it manually when needed
- [ ] See duplicate overlap warnings with similarity score, matched fields, and a link to the existing application
- [ ] Dismiss a duplicate warning permanently (does not re-evaluate on regeneration)
- [ ] Select a base resume and generation settings before generating
- [ ] Generate an ATS-friendly Markdown projection via Pydantic AI + OpenRouter
- [ ] View the resume in rendered preview mode
- [ ] Edit the resume in plain Markdown mode and save
- [ ] Regenerate a single section with required instructions
- [ ] Regenerate the full resume with updated settings and optional instructions
- [ ] Export the current draft as a PDF or DOCX download
- [ ] See status return to In Progress after editing or regenerating a previously exported resume
- [ ] Toggle the Applied flag independently of the primary status
- [ ] Receive in-app notifications for all workflow events
- [ ] Receive email notifications for high-signal events (extraction failed, generation complete, export failed)
- [ ] Admin can view invite and workflow metrics from an admin dashboard
- [ ] Admin can manage users (search/filter, edit, deactivate/reactivate, delete, invite)
- [ ] Manage base resumes (create via file upload or form, edit, delete, set default)
- [ ] Configure section inclusion and order, including custom sections, in each resume workbench
