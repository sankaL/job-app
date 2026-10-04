# Dashboard activity ranges and admin metrics redesign

**Date:** 2026-10-03

## Request

- Make the dashboard look better using the Astryx design system.
- Replace monthly bars with finer bars and 7-day, 30-day, 3-month and year ranges.
- Add a filter parameter so the chart endpoint does not always fetch all data.
- Follow-up: remove the Created / Marked applied / Busiest figures above the chart, and improve Admin Metrics.
- Follow-up: use forms other than bars where they fit.

## Backend

- `GET /api/applications/creation-activity?range=7d|30d|3m|1y&timezone=<IANA>` (defaults: `30d`, `UTC`). Authenticated, owner-scoped and RLS-backed.
- `app/services/creation_activity.py` builds the window from the user's local "today":

  | Range | Granularity | Buckets |
  |---|---|---|
  | `7d` | day | 7 |
  | `30d` | day | 30 |
  | `3m` | day | 90 |
  | `1y` | Monday-start week | 52 (last bucket is the partial current week) |

- `ApplicationRepository.fetch_daily_creation_counts` runs one aggregate grouped by `(created_at at time zone tz)::date`, between the window's local midnights. It returns at most one row per day, never application rows.
- Invalid ranges, unknown or oversized zone names, path-like zone names, and zones Postgres rejects all return 422.
- `tzdata` was added as a dependency so zone names resolve on slim images.
- Migration `20261003_000023_applications_user_created_at_index.sql` adds `(user_id, created_at DESC)`. The runbook covers rollout and verification.

## Frontend

- `fetchCreationActivity` and `useCreationActivityQuery` use `keepPreviousData`. The query key sits under `["applications", ...]`, so existing application invalidations also refresh the chart.
- The Activity section has an Astryx `SegmentedControl` range picker. Bars use two steps of the Astryx blue ramp, stacking "Marked applied" under "Not yet applied", with a 2px gap between segments, rounded tops capped at 24px wide, solid hairline grid lines, an integer y-axis, and a Card tooltip.
- The legend and a screen-reader table carry identity and values. While the next range loads, the previous chart stays visible and dimmed. A failed load shows Retry without hiding the rest of the page.
- `components/dashboard/Composition.tsx` holds the shared donut, stacked composition bar, swatch, section title and labeled rows. Job sources and the admin user/invite breakdowns use the donut. The admin workflow outcome rows keep the stacked bar.
- Follow-up ("too many bars"): status breakdown became four figures with badges and shares, and top companies became a ranked list with Astryx `Avatar` initials and count `Badge`s.
- Follow-up ("needs separation"): the dashboard breakdowns and the admin user/invite donuts each sit inside one flat `PanelGroup` section. Hairline dividers sit between the columns when wide and between the rows when stacked: three columns from `xl`, two from `lg`. Every panel uses the same title-then-content layout without captions. The donut shrank to 112px and the legend is capped at `max-w-sm`, so labels fit in three columns and numbers stay near their labels when stacked.
- Recent activity uses token hover/focus styles instead of JS style mutation. The quota bar uses `ProgressBar`. Metrics show two per row on phones.
- Admin Metrics shows four headline figures (users, invite acceptance, applications, overall workflow success), user and invite composition, and one outcome row per operation. An operation with zero runs reads "No runs" instead of "0.0%".
- `--color-info` is not an Astryx token, so in-progress and pending marks were invisible. They now use `--color-icon-blue`.
- Removed the mobile chart toggle and its CSS, the year selector, and the unused chart tooltip/context helpers.

## Palette validation

The dataviz validator passed `#004CBC, #2694FE` (blue-4/blue-3) on every check against the light surface. Source colors follow the Astryx categorical order per source. All-pairs green/orange CVD separation is below target, which every row's label, count and share mitigates.

## Verification

- `make test-migrate` applied migration 023 locally.
- `make test-backend`: 21 new tests in `tests/test_creation_activity.py`, including a real-Postgres aggregation and isolation test; the full suite passed 470.
- `make test-frontend`: 255 passed after the follow-ups (the suite also includes tests from a concurrent session). `npm run build` passed.
- Headless Chromium screenshots of the dashboard (all four ranges and the tooltip) and Admin Metrics, at 1440px and 400px: no horizontal overflow, and no console errors beyond the expected pre-login 401.
- The first Docker run of the final suite failed while another session was editing shared files at the same time. An identical rerun passed.
