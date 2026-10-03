# Astryx template redesign

## Floating page actions follow-up

Completed 2026-10-03 16:54:00 EDT. Authenticated pages now rely on the top bar for page identity. Their accessible page heading remains, while the duplicate visible title and introduction are removed. Individual applications retain the full job title, company and status in the body.

The existing shared PageHeader adapter portals page actions into a neutral-theme floating group at the bottom right. Multiple actions stay together and wrap on narrow screens. Source name editing, save/upload submission and extension connection controls use the group. Section controls and unsaved/review feedback remain beside their content. A ResizeObserver measures the group for content clearance, fitted workbench height and toast placement; cleanup restores the prior measurement. Application menus open above their trigger. Removed old inline-header action rules and unused source save-button styles.

Review caught a broken Enter submission path for the relocated source name input. Its handler now uses the associated native form's requestSubmit, preserving validation and composition input. Escape still cancels the name edit without discarding section changes. Updated regression coverage verifies save/import submission, rename behavior, action callbacks/group cleanup and the full application body title.

All 238 frontend tests across 18 files passed through the Makefile-managed local Docker stack. The TypeScript/Vite production build passed. Browser checks verified dashboard floating navigation, application body title and upward menu, source name editing/Escape, resume multi-action navigation, upload form, narrow extension controls and mobile drawer route selection. Public pages and data/AI contracts are unchanged.

## Original template conversion

Completed 2026-10-03 16:35:00 EDT on `astryx-ui`.

The user authorized changes to orientation, typography and icons, with a clean, minimal result and sparse card use. This follow-up builds on the committed Astryx installation, neutral theme, CLI initialization and flat-section migration.

Reference: [official Astryx templates](https://astryx.atmeta.com/templates).

## Template mapping

| Official template | Application use |
| --- | --- |
| Shell Nav | AppShell slots, sticky top bar, shared SideNav destinations and native MobileNav drawer |
| Searchable Table | Shared filters and table treatment; title/company before status; long titles wrap |
| Analytics Dashboard | Compact quota row, flat metrics, chart, breakdowns and recent activity |
| Settings Form | Profile fields and section preferences in a single column capped at 720px |
| Page Editor | Source/draft section navigation, paper surface, shared header/actions, flat support regions and save bar |

Read the CLI scaffold sources and layout/component documentation, then adapted the existing pages. Temporary reference scaffolds and their sample data were removed. Marketing, login and invite onboarding retain their public design. No schema, AI prompts, export payloads or data contracts changed.

## Review fixes

- Custom top bars cannot host AppShell's automatic TopNav drawer. Configure MobileNav content explicitly and use MobileNavToggle for open state and accessible relationships.
- Keep one main landmark and the library skip link; immersive comparison removes side navigation.
- Put admin operation icons inline so they cannot overlap totals. Remove obsolete metric tint props and wrapper code.
- Use links for Recent Activity so keyboard users can open application details.
- Use linear chart interpolation so zero-count months never imply negative activity. Disable Area animation so resizing keeps points aligned with their month labels. Add axis padding so endpoint labels remain readable.
- Preserve native controls, stable test identifiers, section editing and pending-operation feedback. Restore public onboarding files affected by the initial typography sweep.
- Delete the old manual sidebar/overlay, card export, unused shell styles and floating save-bar frame. Review summaries are flat sections; raised surfaces remain for menus/dialogs.

## Verification

Verification runs through the Makefile-managed local Docker stack. The final complete frontend suite passed all 236 tests across 18 files. Three focused shell tests, including the new mobile drawer case, also passed. Four focused dashboard cases also passed after the chart review. TypeScript and the production build passed.

Browser checks covered desktop dashboard, applications, resume list, source editor, application workspace, extension, admin metrics/subscription settings, account menu and narrow profile. Mobile navigation opens, closes after choosing a route, dismisses on Escape and restores focus. Narrow applications/profile views have no horizontal overflow. The existing local legacy application has a missing source resume, so its comparison path displays a recoverable error; valid comparison data is covered by regression tests. No user records were edited during verification.

The production build still reports its existing large-chunk advisory. Production deployment is outside this task. Confidence is 95%; user review at their usual viewport and a draft with a live frozen source would strengthen the visual assessment.
