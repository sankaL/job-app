# Task Output — Invite Onboarding and Admin Console

**Date:** 2026-04-10 10:42:00 EDT  
**Scope:** Implement invite-link onboarding for new users, enforce signup profile and password requirements, add admin metrics and user-management surfaces, and align rollout docs.

## Summary

- Added invite-only onboarding flow with tokenized email links sent through Resend.
- Added admin APIs and frontend pages for metrics and user lifecycle operations.
- Added schema support for invite lifecycle tracking and workflow usage metrics.
- Enforced mandatory onboarding fields and password complexity rules for invite signup.
- Added test coverage for public invite APIs, admin APIs, session deactivation gating, and signup UI behavior.

## Delivered Outcomes

- Added migration `supabase/migrations/20260410_000010_phase_5_invites_admin_metrics.sql`:
  - profile columns: `first_name`, `last_name`, `is_admin`, `is_active`, `onboarding_completed_at`
  - invite lifecycle table: `user_invites`
  - workflow event table: `usage_events`
- Added backend modules:
  - admin access dependency and bootstrap logic: `backend/app/core/access.py`
  - Supabase admin API client: `backend/app/services/supabase_admin.py`
  - admin repository/service/routes: `backend/app/db/admin.py`, `backend/app/services/admin.py`, `backend/app/api/admin.py`
  - public invite preview/accept routes: `backend/app/api/public_invites.py`
- Added backend behavior:
  - invite creation pre-provisions Supabase users and sends branded Resend invite emails
  - invite acceptance validates token, expiry, email match, required profile fields, and password complexity
  - deactivated users are blocked on session bootstrap and authenticated extension token issuance
  - extraction/generation/regeneration/export events write to `usage_events` for admin metrics
- Added frontend routes/pages:
  - invite signup page: `/signup`
  - admin metrics dashboard: `/app/admin`
  - admin user management: `/app/admin/users`
  - admin route guard and sidebar navigation entries for admins

## Verification

- Python compile: `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m compileall backend/app backend/tests`
- Backend tests: `backend/.venv/bin/pytest backend/tests/test_admin_api.py backend/tests/test_public_invites_api.py backend/tests/test_extension_api.py backend/tests/test_session_bootstrap.py backend/tests/test_profiles_api.py`
- Frontend tests: `npm test -- src/test/signup.test.tsx src/test/auth.test.tsx`
- Frontend build: `npm run build`
