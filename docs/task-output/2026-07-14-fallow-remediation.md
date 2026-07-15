# Fallow remediation report

**Date:** 2026-07-14 21:35 EDT
**Tool:** Fallow 3.5.0
**Scope:** TypeScript/JavaScript production and test sources covered by `.fallowrc.json`

## Outcome

The calibrated static-check and duplication findings are fully cleared without suppressions. Complexity was reduced substantially in the activity, profile, navigation, API, modal, authentication, dashboard, list, and application-detail surfaces, but a deeper route-level decomposition remains.

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Static/dead-code issues | 14 | 0 | -14 |
| Unused files | 1 | 0 | -1 |
| Unused exports | 10 | 0 | -10 |
| Unused types | 3 | 0 | -3 |
| Duplicate clone groups | 26 | 0 | -26 |
| Duplicated lines | 1,194 (7.18%) | 0 | -1,194 |
| Complexity findings | 45 | 40 | -5 |
| Critical complexity | 12 | 7 | -5 |
| High complexity | 10 | 4 | -6 |
| Moderate complexity | 23 | 29 | +6, primarily smaller extracted helpers |
| Average maintainability | 91.1 | 91.73 | +0.63 |

## Fixed

- Deleted the unused overflow-menu component and its orphaned styles.
- Removed or internalized every reported unused export/type, including stale API/query/auth surfaces and the frontend workflow-contract wrapper.
- Added a shared modal shell and migrated the admin edit/invite and application-create modals.
- Consolidated authenticated/unauthenticated API requests, response error parsing, delete calls, upload calls, and event-stream response checks.
- Added shared authentication page, illustration, branding, and contact-field primitives.
- Consolidated dashboard metrics/year controls, application filters and bulk-result reconciliation, base-resume content fields, job-information fields, notes cards, and admin subscription model controls.
- Split the activity drawer into focused panel, row, event-specific detail, diagnostics, validation, and attempt-timeline components. Its two critical Fallow findings were eliminated.
- Split notification and account-menu presentation from `TopBar`; the former high finding is now moderate.
- Simplified profile hydration/save normalization and several application-detail state/keyword/terminal-progress helpers.
- No `fallow-ignore` suppression was added to hide unresolved findings.

## Security scan review

Fallow security mode reports seven SSRF candidates, all at browser-side `fetch` sinks in `frontend/src/lib/auth.tsx`, `frontend/src/lib/api.ts`, and the Chrome extension popup. The web app requests are rooted in the configured API origin; the extension popup validates the app origin against its explicit trusted-origin rules. These are not server-side arbitrary outbound requests and remain documented manual-review false positives. The Python worker SSRF surface is outside Fallow's TypeScript/JavaScript scope and was separately hardened in B5-T74.

## Deferred

Fallow still reports 40 health findings: 7 critical, 4 high, and 29 moderate. The critical/high remainder is concentrated in:

- `ApplicationDetailPage` and four nested render paths: the primary architectural hotspot at roughly 2,960 lines, cyclomatic complexity 233, cognitive complexity 319.
- `ApplicationsListPage`: 607 lines, cyclomatic 28, cognitive 45.
- `BaseResumeEditorPage`: 288 lines, cyclomatic 23, cognitive 45.
- `DashboardPage`, `SignupPage`, and `AdminSubscriptionsPage`.
- The Chrome extension service-worker listener, which is only 36 lines with cyclomatic complexity 8; Fallow elevates it because it has no runtime coverage signal.

Completing these safely requires route/controller decomposition into dedicated hooks and render components. The current branch already reduced the largest repeated structures and preserved regression coverage; forcing the remaining work into one broad rewrite would increase behavior risk in core generation and resume-editing workflows.

## Verification

- Fallow combined scan: 0 static issues, 0 duplicate groups, 40 documented health findings.
- Fallow security scan: 7 manually reviewed browser-fetch candidates; no newly demonstrated vulnerability.
- Fallow changed-file audit against `origin/main`: 0 dead-code issues and 0 duplicate groups; inherited and newly extracted complexity findings remain visible.
- Frontend Vitest: 153/153 passing.
- Frontend TypeScript/Vite production build: passing.
- Frontend npm audit at high severity: 0 vulnerabilities.

## Input requested

No input is required to use the fixes in this commit. A follow-up decision is needed only if the remaining route-level complexity should be funded now: the recommended next scope is an incremental `ApplicationDetailPage` decomposition with focused application-workflow tests, followed by the list and base-resume routes.
