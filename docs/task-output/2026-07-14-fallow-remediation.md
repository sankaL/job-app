# Fallow remediation report

**Date:** 2026-07-14 22:46 EDT
**Tool:** Fallow 3.5.0
**Scope:** TypeScript/JavaScript production and test sources covered by `.fallowrc.json`

## Outcome

The calibrated static-check and duplication findings are fully cleared without suppressions. The follow-up quality pass reduced health findings from 40 to 8 while keeping all 157 frontend tests green. Complexity is now concentrated in the application-detail controller, with one applications-list and one admin-users controller finding remaining.

| Metric | Initial | Final | Change |
|---|---:|---:|---:|
| Static/dead-code issues | 14 | 0 | -14 |
| Duplicate clone groups | 26 | 0 | -26 |
| Duplicated lines | 1,194 | 0 | -1,194 |
| Health findings | 45 | 8 | -37 |
| Critical health findings | 12 | 1 | -11 |
| High health findings | 10 | 1 | -9 |
| Moderate health findings | 23 | 6 | -17 |

## Fixed

- Removed every confirmed dead file/export/type and all reported clone groups.
- Consolidated modal, authentication, API request, navigation, metric, filter, editor, and activity primitives.
- Split signup into isolated access-request and invite-acceptance controllers. The focused suite caught an unstable effect dependency during refactoring; it was fixed before completion.
- Decomposed the base-resume editor into upload, review, blank-create, and existing-resume flows, eliminating its critical finding.
- Extracted dashboard modeling/presentation, application-list cells/columns/filters/tables/modals, admin-user cells/table/content, extension bridge/status/setup views, and generated-resume workspace views.
- Split ATS keyword and Resume Judge presentation into focused cards, dialogs, groups, and state-specific components while preserving exact match, add/remove, optimization, stale-score, and retry behaviors.
- Simplified the SSE reader/dispatcher, confirmation-modal lifecycle, data-table sorting/pagination, generation progress hooks, Chrome extension service-worker dispatch, profile editor state, and application activity details.
- Applied the final independent review findings: missing-value sorting now stays last in both directions, save-state timers clean up on lifecycle changes, SSE dispatch keeps explicit event payload contracts, generation elapsed state resets between sessions, and the re-upload action no longer submits its parent form.
- Restored normal formatter output across the touched frontend files and added route-level lazy loading. The production build now emits route chunks with no oversized JavaScript chunk warning instead of one 1.16 MB application bundle.
- Added no `fallow-ignore` suppressions and did not weaken analyzer thresholds.

## Security scan review

Fallow security mode still reports seven browser-side `fetch` candidates in `frontend/src/lib/auth.tsx`, `frontend/src/lib/api.ts`, and the Chrome extension popup. The web app requests are rooted in the configured API origin; the extension popup validates the app origin against explicit trusted-origin rules. These are manually reviewed browser-fetch false positives, not demonstrated server-side SSRF. The Python worker SSRF surface is outside Fallow's TypeScript/JavaScript scope and was separately hardened in B5-T74.

## Deferred

Fallow reports 8 remaining health findings: 1 critical, 1 high, and 6 moderate.

- `ApplicationDetailPage` remains the main architectural hotspot at roughly 3,468 formatted controller lines, cyclomatic complexity 211, and cognitive complexity 306. Five smaller findings are synchronization and generation handlers in that controller.
- `ApplicationsListPage` has one high controller finding (cyclomatic 6, cognitive 25) after its presentation and columns were extracted.
- `AdminUsersPage` has one moderate controller finding (cyclomatic 4, cognitive 17).

The remaining application-detail work requires separating extraction, generation, draft synchronization, compare mode, Resume Judge, and modal state into domain hooks. It is deferred because that changes the coordination boundary for the application's most stateful workflow. This pass removes all separable presentation complexity and keeps all 114 application-flow tests green instead of forcing a final controller rewrite without hook-level characterization coverage.

## Verification

- Fallow combined scan: 0 static issues, 0 duplicate groups, 8 documented health findings.
- Fallow security scan: 7 manually reviewed browser-fetch candidates; no newly demonstrated vulnerability.
- Frontend Vitest: 157/157 passing.
- Frontend TypeScript/Vite production build: passing with route-level chunks and no oversized JavaScript chunk warning.
- Frontend npm audit, production and all dependencies: 0 vulnerabilities.

## Input requested

No input is required to use the fixes. A follow-up decision is needed only if the final controller decomposition should be funded now. The recommended next scope is hook-level characterization coverage for `ApplicationDetailPage`, followed by extraction/generation/draft-sync hooks and then the smaller applications-list and admin-users controllers.
