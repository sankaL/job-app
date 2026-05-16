# Task Output — Railway Postgres Production Cutover

**Date:** 2026-05-16 12:11:00 EDT  
**Scope:** Remove the remaining production Supabase dependency by moving the live app onto an in-project Railway Postgres database and the merged custom-auth runtime.

## Summary

- Confirmed the `main` merge commit `2951d5f5eed8b8def2382fa48eabf9a93341e9db` was already deployed to Railway for frontend and agents, but backend was crash-looping because the new auth runtime required missing `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`.
- Confirmed production backend was still pointed at an external Supabase Postgres URL even after the custom-auth merge.
- Provisioned a new Railway Postgres service inside `job-app-prod`, applied the repo-owned SQL migrations from `supabase/migrations/`, rotated production backend JWT signing keys, removed stale Supabase-only variables, and redeployed the backend successfully.
- Seeded a fresh pending invite for the configured admin email so the invite-only onboarding flow remains usable on the clean database.

## Delivered Outcomes

- Railway production now runs on:
  - `frontend`
  - `backend`
  - `agents`
  - `redis`
  - `Postgres`
- Production backend `DATABASE_URL` now targets Railway internal Postgres instead of Supabase.
- Production backend now has fresh RS256 JWT signing keys aligned with the merged custom-auth code.
- Stale production variables tied only to Supabase were removed from backend and frontend services.
- The fresh Railway database has the full repo schema applied through `20260515_000002_replace_supabase_auth.sql`.

## Verification

- Railway service status:
  - `backend` `SUCCESS`
  - `frontend` `SUCCESS`
  - `agents` `SUCCESS`
  - `redis` `SUCCESS`
  - `Postgres` `SUCCESS`
- Backend health:
  - `GET /healthz` returned `200` with `{"status":"ok"}`
- Admin invite bootstrap:
  - Seeded a fresh pending invite for `sanka.lokuliyana@gmail.com`
  - `GET /api/public/invites/preview` returned `200`
- End-to-end auth smoke test on production with a disposable seeded invite:
  - invite preview `200`
  - invite accept `200`
  - login `200`
  - session bootstrap `200`

## Notes

- The admin invite was seeded directly in the clean Railway database to preserve the invite-only onboarding path without temporarily enabling production dev-mode auth.
- Existing Supabase-backed production user records and sessions were intentionally not migrated as part of this cutover; the new Railway Postgres database started clean, as requested.
