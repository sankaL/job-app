# Task Output — Full Posting Extraction, Compensation Text, and Aggressiveness Help

**Date:** 2026-04-09 19:36:58 EDT  
**Scope:** Expand extraction to preserve full posting bodies, add optional raw compensation storage, expose that field in the application workspace, and clarify low or medium or high aggressiveness behavior without enlarging the settings rail.

## Summary

- Extraction now treats `job_description` as the full primary posting body and preserves more page text so lower-page sections like qualifications and compensation are less likely to be dropped.
- Applications now support nullable `compensation_text` for raw salary or compensation text copied from the posting or manual entry.
- The detail workspace now shows and saves compensation, and the Generation Settings card keeps a compact layout while exposing section-by-section aggressiveness effects through inline popovers.

## Delivered Outcomes

- The worker extraction prompt and schema now request the complete posting body plus optional `compensation_text`, while still failing closed on uncertain fields.
- Page capture now prefers `main`, `article`, or `[role="main"]` content before falling back to `body`, and scraped or pasted extraction payloads now preserve up to `40,000` characters.
- Backend contracts, repository reads, worker callback handling, and detail-page write paths now persist and return `compensation_text`.
- The application detail page now lets users review or edit compensation alongside job title, company, posting source, and job description.
- Low, medium, and high aggressiveness controls now surface prompt-aligned rewrite details through repo-local popovers instead of long always-expanded copy.

## Verification

- Python syntax: `PYTHONPYCACHEPREFIX=/tmp/codex-pyc python3 -m py_compile backend/app/api/applications.py backend/app/db/applications.py backend/app/services/application_manager.py agents/worker.py`
- Worker and backend tests: `backend/.venv/bin/pytest agents/tests/test_worker.py backend/tests/test_phase1_applications.py -q`
- Frontend tests: `npm test -- --run src/test/applications.test.tsx`
- Frontend compile/build: `npm run build`
