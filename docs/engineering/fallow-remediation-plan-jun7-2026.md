# Fallow Remediation Plan - June 7, 2026

**Source:** `docs/engineering/fallow-output-1-jun7-2026.json`  
**Calibration output:** `docs/engineering/fallow-output-2-after-config-jun7-2026.json`  
**Fallow version:** 2.89.0  
**Plan status:** Proposed implementation order  
**Last updated:** 2026-06-07 14:23:00 EDT

## Executive Summary

Address the Fallow findings in this order:

1. **First issue to address: Fallow signal hygiene plus safe dead-code cleanup.** This is the best value-for-effort bundle because it removes noise, prevents accidental deletion of runtime assets, and clears several real stale exports with low behavior risk.
2. **Then refactor medium-sized duplicated UI and helper patterns.** The shared modal structure and small helper extraction work reduce future churn without touching the most fragile page first.
3. **Then tackle the large application workspace refactor.** `ApplicationDetailPage.tsx` is the highest-risk maintainability issue, but it is also high effort and should be split after the smaller guardrail work has improved test/tool signal.

The output is directionally useful, but several findings are not actual defects. Runtime-loaded files, Vite test setup, Chrome extension assets, and mirrored extension test helpers should be classified rather than deleted.

## Calibration Run Results

After adding `.fallowrc.json` for the verified runtime/test false positives, Fallow was re-run with:

```bash
npx --yes fallow@2.89.0 --root . --config .fallowrc.json --no-cache --format json
```

The calibrated output is saved at `docs/engineering/fallow-output-2-after-config-jun7-2026.json`.

| Area | Before | After config calibration | Result |
|---|---:|---:|---|
| Total static check issues | 22 | 14 | 8 noisy findings removed |
| Unused files | 5 | 1 | Runtime/test assets removed from the issue list |
| Unresolved imports | 1 | 0 | `/env-config.js` calibrated |
| Duplicate exports | 3 | 0 | Extension/test-helper duplicate exports calibrated |
| Unused exports | 10 | 10 | Still needs code review/cleanup |
| Unused types | 3 | 3 | Still needs code review/cleanup |
| Duplicate clone groups | 98 | 98 | No code duplication was fixed yet |
| Complexity findings | 28 | 28 | No complexity refactor was done yet |
| Average maintainability | 90.9 | 91.1 | Small improvement from removing false-positive file scoring noise |

Remaining static-check items after calibration:

- `frontend/src/components/ui/overflow-menu.tsx` is the only remaining unused file.
- 10 unused exports remain: `Breadcrumbs`, `ChartLegend`, `ChartLegendContent`, `SkeletonBlock`, `SkeletonTableRow`, `fetchProfile`, `getAccessTokenSync`, `updateAdminUsersCache`, `workflowContract`, and `visibleStatuses`.
- 3 unused types remain: `ShellLayoutMode`, `User`, and `VisibleStatusId`.

Conclusion: the calibrated run should happen before code fixes, and it now has. The next run should happen after Phase 1 cleanup to measure actual remediation.

## What The Report Says

| Area | Count / Metric | Notes |
|---|---:|---|
| Static check issues | 22 | 5 unused files, 10 unused exports, 3 unused types, 1 unresolved import, 3 duplicate exports |
| Duplicate code | 98 clone groups | 3,296 duplicated lines, 15.8% duplication across analyzed frontend files |
| Complexity findings | 28 | 7 critical, 9 high, 12 moderate |
| Maintainability average | 90.9 | Overall codebase is not broadly unhealthy; the risk is concentrated |
| Top hotspot | `frontend/src/routes/ApplicationDetailPage.tsx` | 2,943 LOC, high churn, max cognitive complexity 226 |

## Critique Of The Findings

Not every reported issue should become a refactor:

- `frontend/public/env-config.js` is intentionally loaded by `frontend/index.html` and generated/replaced in production runtime flows. Treat the unresolved `/env-config.js` and unused-file warning as tool configuration noise, not deletion work.
- `frontend/public/chrome-extension/popup.css` and `frontend/public/chrome-extension/service-worker.js` are Chrome extension runtime assets referenced by `popup.html` and `manifest.json`. They should not be deleted.
- `frontend/src/test/setup.ts` is referenced from `frontend/vite.config.ts`; this is another static-analysis false positive.
- The three duplicate export findings for `buildImportRequest`, `normalizeAppOrigin`, and `isTrustedAppUrl` come from the public extension module plus a test helper declaration/import pattern. Prefer a test-friendly module boundary or Fallow config over renaming runtime extension functions.
- `frontend/src/components/ui/button.tsx` is flagged as a high-impact split target, but it is only 71 LOC and high fan-in is expected for a design-system primitive. Splitting it now would likely create churn with little user value.
- The largest duplication bucket is `frontend/src/test/applications.test.tsx`. That is real maintenance drag, but it does not come before production-code clarity unless test edits are already part of the same feature work.

## Phase 1 - High Value, Low Effort

**Goal:** Clear obvious noise and small real issues first, so future Fallow runs are trustworthy and the team does not waste effort on false positives.

### Bundle 1.1 - Calibrate Runtime Asset Findings

**Address first.**

Classify or configure Fallow for intentional runtime files:

- Keep `frontend/public/env-config.js`; document/configure it as runtime-loaded from `frontend/index.html`.
- Keep Chrome extension runtime files under `frontend/public/chrome-extension/`, especially `popup.css` and `service-worker.js`.
- Keep `frontend/src/test/setup.ts`; it is the Vitest setup file.
- Resolve the `/env-config.js` unresolved-import finding through Fallow ignore/config rather than code removal.

**Why first:** prevents destructive cleanup, makes the rest of the report more actionable, and costs little.

**Acceptance criteria:**

- No plan or cleanup deletes runtime config, extension assets, or test setup.
- A follow-up Fallow run no longer reports these known false positives, or they are explicitly suppressed with rationale. **Completed by `docs/engineering/fallow-output-2-after-config-jun7-2026.json`.**

### Bundle 1.2 - Remove Or Internalize Truly Stale Frontend Exports

Review and clean unused exports/types where the symbol is not part of an intentional public component API:

- `Breadcrumbs` in `frontend/src/components/layout/Breadcrumbs.tsx`: likely make non-exported while keeping `AppBreadcrumbs`.
- `SkeletonBlock`, `SkeletonTableRow`, and related skeleton exports: keep internally used helpers private unless intentionally exported.
- `ShellLayoutMode`, `User`, `VisibleStatusId`, `workflowContract`, `visibleStatuses`: remove exports only if no external module or test imports require them.
- `fetchProfile`, `getAccessTokenSync`, `updateAdminUsersCache`: verify production and test usage before changing. These may be intentionally exported for query or mock surfaces.
- `frontend/src/components/ui/overflow-menu.tsx`: likely real dead source. If confirmed unused, delete the component and its CSS selectors together.

**Why now:** removes low-risk clutter and catches stale design-system surface area before more refactoring.

### Bundle 1.3 - Extract Shared Modal Shell And Modal Lifecycle Hooks

Bundle duplicated modal structure across:

- `frontend/src/components/admin/EditUserModal.tsx`
- `frontend/src/components/admin/InviteUserModal.tsx`
- `frontend/src/components/applications/CreateApplicationModal.tsx`

Recommended extraction:

- Shared modal shell for portal, overlay, dialog frame, title/description IDs, and close button area.
- Small hooks for body scroll lock, Escape close, and initial focus where the behavior matches.
- Keep form-specific validation and submit logic local to each modal.

**Why phase 1:** this removes several production-code duplication families at once, touches user-visible admin/intake flows, and is much safer than starting inside the full application detail page.

### Bundle 1.4 - Extract Small Pure Helpers From Activity/Profile Hotspots

Target small, testable helpers before larger component moves:

- Move `hasExpandableDetails` logic in `ApplicationActivityPanel.tsx` into named pure predicates.
- Split event detail rendering helpers from the main activity panel render path.
- In `ProfilePage.tsx`, extract profile form normalization/validation and save payload construction.

**Why phase 1:** these files have critical complexity findings, but the risky part can be reduced through narrow pure-function extraction.

### Phase 1 Validation

- Existing frontend tests covering auth, applications, signup, extension, and profile surfaces should still pass.
- Manual smoke coverage should include opening the app shell, creating an application modal, opening admin invite/edit user modals, and checking the Chrome extension asset route still serves files.
- Fallow should show fewer static-check findings and lower duplication around modal families.

## Phase 2 - Medium Value, Medium Effort

**Goal:** Reduce maintenance risk in high-churn product surfaces once the easy cleanup is out of the way.

### Bundle 2.1 - Staged `ApplicationDetailPage.tsx` Decomposition

This is the biggest real issue, but it should be split incrementally.

Recommended order:

1. Extract pure state transition helpers:
   - `applyTerminalGenerationProgress`
   - `applyDetailState`
   - `applyDraftState`
   - `getGenerationStartBlocker`
2. Extract render-only sections:
   - Resume Judge card
   - Generated workspace pane
   - generation settings panel
   - recovery/manual-entry panels
3. Extract workflow hooks after render sections are stable:
   - detail and draft hydration
   - generation/regeneration actions
   - SSE/progress reconciliation

**Why phase 2:** the page is the top hotspot and has the highest cognitive complexity, but it carries core resume workflow behavior. Start with pure helpers and render extraction before changing orchestration.

### Bundle 2.2 - Consolidate API Request And SSE Error Handling

Targets:

- `frontend/src/lib/api.ts`, especially `openApplicationEventStream`.
- Repeated request/response/error normalization blocks.
- Duplicate API payload construction patterns.

Recommended approach:

- Extract shared response parsing and sanitized error helpers.
- Keep endpoint-specific payload types and function names intact.
- Add focused coverage for SSE auth, reconnect/failure handling, and sanitized errors.

**Why phase 2:** this supports Phase 5 reliability goals and reduces the chance that future async workflow changes diverge across endpoints.

### Bundle 2.3 - Share Auth/Onboarding UI Primitives

Targets:

- `frontend/src/routes/LoginPage.tsx`
- `frontend/src/routes/SignupPage.tsx`
- overlapping profile/contact field groups with `EditUserModal.tsx`

Recommended extraction:

- Auth page frame/visual shell.
- Password requirement or input field primitives.
- Contact/profile field group only if labels, validation, and payload semantics truly match.

**Why phase 2:** Fallow reports 243 duplicated lines across login/signup. This is worth addressing, but the pages are stable enough that it can follow the modal work.

### Bundle 2.4 - Applications List And Table Rendering Helpers

Targets:

- `frontend/src/routes/ApplicationsListPage.tsx`
- `frontend/src/components/ui/data-table.tsx`
- dashboard/list duplicate summary rendering where identical.

Recommended extraction:

- Filter/sort derivation helpers.
- Row action rendering helpers.
- Shared empty/error/loading presentation only where behavior matches.

**Why phase 2:** useful, but less urgent than detail-page complexity and shared modal/API foundations.

## Phase 3 - Lower Value Or Defer Until Touched

**Goal:** Avoid churn for low-return findings while keeping a backlog for opportunistic cleanup.

### Bundle 3.1 - Test Duplication Cleanup

Targets:

- `frontend/src/test/applications.test.tsx`: 1,430 duplicated lines across 66 clone groups.
- `frontend/src/test/auth.test.tsx`
- `frontend/src/test/ErrorBoundary.test.tsx`
- `frontend/src/test/data-table.test.tsx`
- `frontend/src/test/signup.test.tsx`

Recommended approach:

- Do not start here unless test maintenance is actively slowing work.
- Extract fixtures/builders only when adding or changing tests in the same area.
- Prefer readable scenario helpers over over-abstracted test DSLs.

### Bundle 3.2 - Defer The `button.tsx` Split Target

The button file is small and central. Keep it as-is unless:

- variants grow substantially,
- accessibility behavior diverges by usage,
- or consumers require different semantic components.

High fan-in is expected for a design-system primitive and is not by itself a reason to split.

### Bundle 3.3 - Opportunistic Moderate Complexity Cleanup

Defer until the files are touched for feature or bug work:

- `TopBar.tsx`
- `DashboardPage.tsx`
- `ErrorBanner.tsx`
- `generation-progress.tsx`
- `BaseResumeEditorPage.tsx`
- `AdminSubscriptionsPage.tsx`
- `Sidebar.tsx`
- `Breadcrumbs.tsx`

For these, prefer small helper extraction and targeted tests rather than broad component rewrites.

### Bundle 3.4 - Chrome Extension Complexity Suppression Or Focused Test

The `service-worker.js` complexity finding appears inflated by low/no coverage rather than high cognitive complexity. Keep the runtime file, and either:

- add a focused extension service-worker behavior test if the current harness supports it, or
- suppress the finding with a comment/config entry that explains the Manifest V3 runtime boundary.

## Suggested Implementation Sequence

| Order | Bundle | Value | Effort | Risk | Notes |
|---:|---|---|---|---|---|
| 1 | Runtime asset classification and Fallow config | High | Low | Low | Best first step; prevents bad cleanup |
| 2 | Safe stale export/internalization pass | Medium | Low | Low-Medium | Verify tests and intentional APIs first |
| 3 | Shared modal shell/hooks | High | Low-Medium | Medium | Removes visible production duplication |
| 4 | Activity/Profile pure helper extraction | Medium | Low-Medium | Medium | Shrinks critical findings safely |
| 5 | `ApplicationDetailPage.tsx` staged decomposition | Very High | High | High | Biggest real hotspot; do after guardrails |
| 6 | API/SSE helper consolidation | High | Medium | Medium | Supports async reliability work |
| 7 | Auth/signup shared primitives | Medium | Medium | Medium | Useful duplication cleanup |
| 8 | Applications list/table helpers | Medium | Medium | Medium | Good opportunistic refactor |
| 9 | Test duplication builders | Low-Medium | Medium | Low | Defer until test edits are already needed |
| 10 | Button split and minor moderate findings | Low | Low-Medium | Medium | Defer unless files change for other reasons |

## Definition Of Done For The Whole Cleanup Track

- Intentional runtime assets are configured/suppressed with rationale.
- Real unused exports/files are removed or made private.
- No Chrome extension, runtime config, auth, or application workflow behavior regresses.
- Main production duplication families in modals and API helpers are reduced.
- `ApplicationDetailPage.tsx` is split enough that the main component no longer owns all rendering, progress reconciliation, and action orchestration at once.
- Fallow output is re-run and the remaining findings are either materially reduced or intentionally documented.
