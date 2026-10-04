# Frontend — Agent Guidance

Keep this file focused on durable frontend rules for the AI Resume Builder. Do not add setup commands, ports, env-var instructions, or speculative component maps.

## Source of Truth
- Product behavior and UX contract: `docs/resume_builder_PRD_v3.md`

## Frontend Commitments
- Follow the committed frontend stack: React, Vite, Tailwind CSS, and Astryx core with the neutral theme.
- Treat the frontend as responsible for the authenticated user experience across:
  - login
  - applications dashboard
  - new application flow
  - application detail workspace
  - base resume management
  - profile and resume workbench structure
  - notifications
  - PDF export initiation
- Keep client-side status labels and attention indicators aligned with the PRD's visible status model.

## UX Rules
- Keep authenticated pages on the shared Astryx neutral theme and existing UI adapters. Primary CTA buttons use the standard neutral button variants. Buttons, table rows, sections and form controls share semantic theme tokens. Selection and action dropdowns use DropdownMenu; native backing select fields preserve validation, form data, change events and refs. Information/notification panels retain their dialog/popover roles.
- Action buttons use the shared Astryx Button adapter, including sign-in. Adjacent related actions use ActionButtons backed by Astryx ButtonGroup; a lone action stays a regular Button. Keep native sizing and shape instead of adding floating pills or per-button shadows. Groups share size and have exactly one designated primary action. App-shell page-action primaries use orange backgrounds with white text; other primaries use the neutral black background. Other actions use secondary styling, with error styling for secondary destructive actions. Keep the primary choice stable during loading or disabled states. Tabs, view selectors and menus keep their navigation semantics.
- Use flat Astryx sections, spacing and dividers for page regions, forms, metrics, review summaries and lists. Keep a distinct resume paper surface and raised overlay frames; avoid nested cards.
- Page-level actions sit in the app shell top bar beside notifications, with related actions grouped. Keep the existing button styling and orange primary CTA. Keep section-specific controls beside their content. Preserve native form association, keyboard submission and notification visibility.
- Keep the marketing, login and invite onboarding pages on their isolated public styles. Login, access-request and invite setup share `AuthPageShell`: the logo-only illustration panel on the left, and on the right the heading, feedback under it, a divider and the form. Use `/applix-logo.svg` as the single logo source. Use Astryx shell, searchable table, settings and editor templates to guide authenticated layout. Keep the existing content and actions; adapt orientation for readable forms and rows. Profile follows the settings template with full-width description/form columns and stacked fields on narrow screens, without a separate section navigation rail or tabs. Share AppShell, SideNav, MobileNav, page headers and semantic Heading/Text typography.
- Application and admin-user tables share the Astryx table-filter adapter, with filter chips, collapsible groups, view options and borderless row icons. Keep every column/action reachable through horizontal scrolling on narrow screens. Current-page selection covers expanded rows; existing selections survive group collapse. Saved views belong to the mounted page session.
- Use the Astryx documentation template for the resume library: a responsive grid of clickable preview cards with persistent search, default status, dates and separate Edit/Delete/Set Default actions. Card activation opens the resume workbench; nested actions must not navigate. This is an explicit exception to flat list rows.
- Use skeleton loading states for async page and list fetches.
- Provide meaningful progress messaging during extraction, generation, regeneration, and export flows. Full generation, job extraction and resume import use a compact centered progress card with changing explanations over a resume skeleton with a decorative SVG avatar, without step lists. Job extraction and full generation show an eased bar (fast to about 70%, then slowing toward a 94% ceiling) whose target is at least the reported progress and whose displayed value catches up smoothly without moving backwards and shows 100% only when the job reports it; the slow-job notice still follows real updates. Import stays indeterminate. Elapsed time counts from the job's reported start, job extraction offers Stop extraction on the card, and every processing view shows a slow-job notice after 90 seconds without a progress update. A spinner alone is not sufficient. Section/role regeneration stays inside the mounted workbench with unframed skeleton lines and progress in the target content; keep navigation and unrelated content visible.
- Preserve the mounted route and unsaved editor state when comparison hides navigation or responsive shell layout changes.
- Honor grouped-column custom sort values and the selected direction. Keep cached dashboard activity visible with a refresh error and Retry when refetching fails.
- Show clear transient success and error feedback.
- Surface action-required states prominently on dashboard and detail views.
- Application supporting details start read-only with per-field editing and compact empty states. Keep job/settings Save semantics and notes autosave; use the three-stop aggressiveness slider with full descriptions on hover/focus/touch and a visible High warning.
- Open base and application section workbenches in preview. Use each section's Edit action or double-click to open only that section's inline Markdown/entry editor. Preserve unsaved edits, section controls and section/entry regeneration. Contact information is managed through the profile.
- Use optimistic UI only where the operation is low-risk and can be rolled back cleanly, such as toggling the `applied` flag.
- Preserve clear empty states and next-step calls to action for first use and failure recovery.

## Frontend Data and State Rules
- Reflect the four primary statuses exactly: `Draft`, `Needs Action`, `In Progress`, and `Complete`.
- Treat `applied` as a separate boolean flag, not a replacement for the primary status.
- Show duplicate-review attention before generation when unresolved.
- After editing or regenerating a previously exported draft, the UI must reflect the status return to `Needs Action`.
- The workbench edits the latest versioned section document. Compare against its stored source snapshot using stable IDs and provenance; the deterministic Markdown projection feeds export.
- Base document inclusion/order controls initial generation. Saved drafts own their structure for editing, regeneration and export; refresh the frozen source only through an explicit latest-base reset.

## Frontend Security Rules
- Local dev login selects an existing active local account without a password. Keep the account-list request behind dev mode; production retains email/password login.
- Do not store auth tokens in `localStorage`.
- Treat all fetched job, resume, and notification data as private to the authenticated user.
- Do not expose hidden internal processing details as substitutes for the user-facing status model.
- Fail safely when auth expires or required data is missing, and route the user toward re-authentication or recovery instead of masking the issue.

<!-- ASTRYX:START -->
Astryx v0.6.5 · 166 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template. Never lay out a page from scratch:
1. `astryx build "<idea>"` — START HERE: names the [page] template to start from (always one: the closest match, or the app shell), two other templates, and the [block]s + [component]s for parts it lacks. No args = full playbook.
2. `astryx template <name> <path>` — scaffold that template into your project. Keep its frame, gap and padding; replace its data, copy and sections; delete sections you do not need.
3. `astryx template <Block>` for a part the template lacks; `astryx component <Name>` for props + examples before you use or change a component.
Changing a page you already have? Keep it: skip step 2 and add blocks and components inside its sections.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: the template you scaffold sets the page frame. Read `astryx docs layout` before you change it — region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else Tailwind utilities backed by tokens (bg-surface, text-primary, rounded-lg) via tailwind-theme.css. No raw hex/px.
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any style={{…}}, raw <div>/<span> layout, imported .css/@apply, or hardcoded/arbitrary value (e.g. bg-[#fff], p-[13px]) with the component or a token-backed utility. Confirm the page kept its template's frame, gap and padding. If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   166 components by category
  template --list    page + block recipes
  docs <topic>       authoring, browser-support, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  docs cli           commands, API reference, integration authoring (one level at a time)
  swizzle <Name>     eject component source for deep customization
  upgrade --from <old version> --apply   run after any Astryx or integration dependency bump
<!-- ASTRYX:END -->
