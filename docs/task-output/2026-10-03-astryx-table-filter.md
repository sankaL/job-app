# Astryx table-filter redesign

Completed 2026-10-03 17:53:37 EDT.

## Implementation

Ran the requested `npx @astryxdesign/cli template table-filter ./src/app/table-filter`, plus the CLI build recommendation and Table/Selector/layout documentation. Adapted the template into `frontend/src/components/ui/data-table.tsx` and removed the unused scaffold and fixture jobs.

Application and admin-user tables share the native Astryx Table and grouped-row plugin. The toolbar supports search, field chips, result counts and filter clearing. Applications support multiple statuses, company/base-resume filters and a separate applied filter. Admin status filtering retains the existing server query; tier filtering operates on its returned rows.

View options control grouping, column visibility and three row densities. Saved views capture search, filters, grouping, columns, density and sorting in memory for the mounted page session. Controls state that lifetime. Applications default to company groups with newest-updated rows first within each group. Pagination remains bounded; collapsed rows are excluded from current-page selection, while prior selections are preserved and counted. Every column remains reachable by horizontal scrolling on narrow screens.

Applied, delete, stop extraction and admin edit/access/delete controls use borderless icons, labels and tooltips. Disabled actions remain disabled, including self-account actions and deletion during generation. Existing confirmation, failure recovery and bulk-action paths remain intact. Status/tier tokens use pill shapes.

Updated the PRD, frontend guidance, decisions log and build plan. No schema, backend, AI or export changes belong to this task. Other work was already present and continued concurrently, including dashboard, local login and AI changes; those edits were preserved.

## Verification

- Makefile-managed local Docker tests and production builds only.
- Final TypeScript/Vite production build passed. Vite retains its bundle-size advisory.
- Full frontend suite: 247 passed, one failed out of 248. The failure referenced an old dashboard `Busiest week` label during concurrent dashboard changes. The updated test passed on a focused rerun. All table tests passed, including numeric/date sorting, null placement, pagination, row keyboard activation, selection, disabled actions, multiple-status filtering, group collapse, empty-result recovery and saved-view restoration.
- An older assertion for the removed `align-middle` utility was replaced by functional multi-status coverage; alignment was checked in the live browser. The saved-view interaction test has a 15-second bound to accommodate the full suite's concurrent load.
- Browser checked applications and admin users, multi-status and tier filters, grouping/collapse, view menus, saved-view creation/restoration, disabled self-account actions and borderless icons.
- At the narrow browser setting, the page scroll width equaled the viewport width, while the table scrolled independently. The viewport override was reset afterward.
- Existing jsdom chart-size/navigation warnings and an Astryx dropdown key warning appeared during tests; none failed assertions.
- `git diff --check` passed.

Saved views do not persist after leaving or reloading the page. Pixel-for-pixel equivalence with the reference is not asserted; the same Astryx table structure and controls use this app's columns, typography and page shell.
