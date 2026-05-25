# Application Activity Log Side Panel

**Date:** 2026-05-25 10:20:00 EDT
**Status:** Completed

## Summary

Implemented a user-facing application activity timeline on the Application Detail page with a right-side drawer, backed by authenticated, user-scoped activity events from `usage_events`.

## What Changed

- Added a shared backend `UsageEventRepository` for durable `usage_events` read/write access.
- Updated application and admin services to use the shared usage-event repository instead of admin-only coupling.
- Added `GET /api/applications/{application_id}/activity` with authenticated user scoping and newest-first ordering.
- Added synthetic `application_created` activity when older records do not already contain one.
- Added activity payload support for:
  - `id`, `type`, `status`, `title`, `summary`, `created_at`
  - optional `details`, `failure_message`, and `attempts`
- Logged manual and AI workflow actions across creation, extraction, manual recovery, generation, regeneration, Resume Judge, draft edits, exports, duplicate resolution, applied toggles, and notes updates.
- Sanitized AI diagnostics in activity metadata and attempt details (model, retry outcome, duration, reasoning, and retry reason only).
- Added `ApplicationActivityPanel` side drawer UI with:
  - header Activity button on Application Detail
  - lazy fetch only when opened
  - compact first-look timeline
  - failure-first treatment with visible error messages
  - expandable AI detail rows for model/attempt/duration/failure-stage context
- Wired detail-page activity query invalidation after major actions so an open panel refreshes timeline data.
- Added backend and frontend test coverage for activity endpoint behavior, event sanitation, drawer fetch behavior, timeline rendering, expansion, and empty/loading/error states.
- Updated schema docs with user-facing `usage_events.metadata` activity key contracts.

## Validation

- `python3 -m pytest backend/tests/test_phase1_applications.py backend/tests/test_admin_service.py -q` passed.
- `npm test -- src/test/applications.test.tsx` passed.
