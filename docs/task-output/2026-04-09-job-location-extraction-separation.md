# 2026-04-09 — Job location extraction separation

## Summary

- Added a nullable `applications.job_location_text` field and migration so extraction and manual entry can store raw location or hiring-region text separately from compensation.
- Updated the extraction schema and prompt contract so `job_location_text` and `compensation_text` are separated semantically from page context, even when both appear on the same rendered line.
- Exposed `job_location_text` in the application detail Job Information card and manual-entry form so users can review and edit the extracted location text.

## Files changed

- `agents/worker.py`
- `agents/tests/test_worker.py`
- `backend/app/api/applications.py`
- `backend/app/db/applications.py`
- `backend/app/services/application_manager.py`
- `backend/tests/test_phase1_applications.py`
- `frontend/src/lib/api.ts`
- `frontend/src/routes/ApplicationDetailPage.tsx`
- `frontend/src/test/applications.test.tsx`
- `supabase/migrations/20260409_000009_phase_4_application_job_location_text.sql`
- `docs/resume_builder_PRD_v3.md`
- `docs/database_schema.md`
- `docs/backend-database-migration-runbook.md`
- `docs/prompts.md`
- `docs/build-plan.md`
- `docs/decisions-made/decisions-made-1.md`

## Validation

- Python syntax compilation for the changed worker and backend files
- Focused worker and backend pytest coverage for extraction persistence and duplicate-review safety
- Focused frontend test coverage for saving the new Location field from the application detail page

## Notes

- The separation between `job_location_text` and `compensation_text` is intentionally model-driven and context-based. No employer-specific or line-splitting heuristic was added for Accenture-style postings.
- No backfill was added. Existing rows may keep `NULL` `job_location_text` until re-extracted or manually edited.
