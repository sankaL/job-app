# Task Output — Overfetch Reduction and Railway Frontend Runtime Optimization

**Scope:** Move the frontend off the Railway Vite dev server, centralize shared client-side data fetching with React Query, remove redundant shell/page fetches, and add bootstrap summary counts so shell attention state no longer depends on a full applications list fetch.

## What Changed

- Replaced the frontend production container path with a multi-stage build that compiles the Vite app and serves `dist/` from nginx.
- Added runtime config injection through `env-config.js`, with frontend env parsing now reading runtime config first and `import.meta.env` as the local-dev fallback.
- Added a shared React Query client and typed query keys for bootstrap, applications, detail, drafts, base resumes, notifications, admin metrics, and admin users.
- Refactored the app shell and primary routes to use shared cached queries instead of repeated page-local `useEffect` fetches.
- Removed the `NOTIFICATIONS_CLEARED_EVENT` window-event fanout and replaced it with query invalidation after inbox clears.
- Extended session bootstrap with aggregated `application_summary` counts so shell badge state is available without fetching `/api/applications`.

## Key Code Areas

- Frontend runtime and config:
  - `frontend/Dockerfile`
  - `frontend/docker-entrypoint.sh`
  - `frontend/nginx/default.conf.template`
  - `frontend/src/lib/env.ts`
- Shared client data layer:
  - `frontend/src/lib/query-client.ts`
  - `frontend/src/lib/queries.ts`
  - `frontend/src/components/layout/AppContext.tsx`
- Backend bootstrap aggregate:
  - `backend/app/api/session.py`
  - `backend/app/db/applications.py`

## Verification

- `cd frontend && npm run test -- --run src/test/applications.test.tsx -t "loads the applications page|loads the dashboard|loads the resumes page|initializes the profile page|clears only notifications|does not re-request base resumes"`
- `cd frontend && npm run build`
- `python3 -m pytest backend/tests/test_session_bootstrap.py`

## Notes

- The full legacy `frontend/src/test/applications.test.tsx` file still contains many older assumptions about effect timing, eager shell fetches, and mock call counts that do not yet match the shared-query model; this task added focused regression coverage for the new request-reduction contract instead of rewriting the entire legacy suite in one pass.
- Backend connection pooling was intentionally left out of scope for this task. If Railway cost remains high after deploy, pooling should be the next backend-focused optimization.
