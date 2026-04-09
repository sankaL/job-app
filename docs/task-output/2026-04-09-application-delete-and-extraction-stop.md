# Task Output — Application Delete Icons and Extraction Stop Recovery

**Date:** 2026-04-09 13:59:38 EDT  
**Scope:** Add icon-only application delete controls, introduce user-triggered extraction stop recovery, and cover the new behavior across backend, frontend, and docs.

## Summary

- Added icon-only delete controls to the applications table and application detail header.
- Introduced `POST /api/applications/{application_id}/cancel-extraction` so actively extracting applications can be stopped and moved into recoverable manual-entry state.
- Reused the existing `manual_entry_required` + `extraction_failed` recovery path, but tagged user-stopped rows with `extraction_failure_details.kind = "user_cancelled"` and fenced stale worker callbacks with terminal progress job ids.

## Delivered Outcomes

- Users can delete idle applications from the table row action cluster and from the detail header without relying on bulk actions.
- Users can stop stuck extractions from both the table and the detail page, then retry extraction, paste source text, complete manual entry, or delete the application.
- User-triggered extraction stops do not create action-required notifications and do not allow late extraction worker callbacks to overwrite the recovery state.

## Verification

- Backend: `./.venv/bin/pytest tests/test_phase1_applications.py -q`
- Frontend: `npm test -- --run src/test/applications.test.tsx`
- Frontend compile/build: `npm run build`
