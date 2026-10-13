# Admin workflow outcomes over time (2026-10-13)

## Goal
Admin Metrics should show workflow success and failure trends for a chosen range (1W, 1M default, 3M, 6M, 1Y, All) as a smooth two-line chart. The server returns only the selected window.

## Backend
- **`app/services/workflow_outcomes.py`**: `build_outcome_window` validates the range, the timezone (reusing `resolve_timezone` from `creation_activity.py`) and the clock, then sizes fixed buckets. `summarize_outcomes` rolls per-day rows into day, week or month buckets for each operation and drops rows outside the window and unknown event types.
  - Ranges: `7d` day ×7, `30d` day ×30, `3m` week ×13, `6m` week ×26, `1y` week ×52.
  - `all`: the window looks up the earliest workflow event only for this range, and only after validation. History of ≤31 days uses days (at least 7). History of ≤1 year uses Monday-start weeks. Anything older uses calendar months, capped at 120. With no events, it falls back to the 30-day window.
- **`app/db/usage_events.py`**: `fetch_daily_operation_outcomes` groups by local day and event type within `[start_at, end_before)`. It sets a 5s statement timeout, and an invalid timezone surfaces as `ValueError`. `fetch_earliest_operation_event_at` returns `min(created_at)`. Both use the service connection because this is a cross-user admin aggregate. The existing `idx_usage_events_event_type_created_at` index serves both queries.
- **`AdminService.get_workflow_outcomes`** and the route **`GET /api/admin/workflow-outcomes`** (admin-only): `range` defaults to `30d` and `timezone` to `UTC`. Invalid input returns 422.
- **`GET /api/admin/metrics`** no longer includes `extraction`, `generation`, `regeneration` or `export`. The old all-time `get_operation_metrics` (in both repositories) is gone.

## Frontend
- **`lib/api.ts` / `lib/queries.ts`**: `fetchWorkflowOutcomes` and `useAdminWorkflowOutcomesQuery`, with `keepPreviousData` and a one-minute stale time. The workflow fields were removed from `AdminMetrics`.
- **`routes/AdminDashboardPage.tsx`**: the `WorkflowOutcomesSection` contains:
  - a `Select` operation dropdown and a range `SegmentedControl`
  - a Recharts `LineChart` with two `monotone` lines, dots on hover only
  - a tooltip card, a legend, an sr-only data table, and per-operation rate rows
  - dimmed previous data while a new range loads, and inline Retry on failure
  - Chart config keys are `succeeded`/`failed`, not `success`/`error`, so `ChartContainer`'s `--color-<key>` variables never reference themselves.
  - The Workflow success tile shows the range totals. It shows "—" and "Loading…" or "Unavailable" until the data arrives.
- **`lib/local-dates.ts`**: shared `resolveBrowserTimezone`, `parseLocalDate` and `formatLocalDate`, used by both dashboards.
- **`CompositionBar`** was removed from `components/dashboard/Composition.tsx`. Nothing else used it.

## Review follow-ups
- **Failed range switch:** `keepPreviousData` only applies while the new key is pending. The page now remembers the last loaded outcomes, so a failed switch keeps that range's chart, caption and tile visible beside "could not be refreshed" and Retry.
- **Statement timeout:** a timeout on either query (`QueryCanceled`) becomes `TimeoutError`, and the route returns 503 "Workflow outcomes took too long to load. Try a shorter range."
- **Test isolation:** `src/test/setup.ts` removes Astryx's singleton live regions after each test. Astryx re-attaches them on the next announcement. A toast announced in one test was still matching `getByRole("alert")` in the next. Astryx announces each toast once, through these regions.
- **Build fix:** the `onSave` mock in `resume-section-workbench.test.tsx` now has the real `(document, revision)` signature, which fixes a `tsc` error that broke `npm run build`.
- **Orange buttons:** not changed. The orange in-section primaries in the Admin Subscriptions save button and the Resume Judge regenerate button were left as the owner made them.

## Verification
- `make test-backend`: 609 passed, including the local-Postgres aggregation test. That test uses 2001 dates, so real dev usage cannot fall inside its window.
- `make test-frontend`: 352 passed.
- `make test-build`: passes.
- Headless Chromium against the local stack as the dev admin: the first load requests `range=30d` in the browser timezone, and "All" adds one request. Screenshots at 1440px and 400px show no horizontal overflow.
