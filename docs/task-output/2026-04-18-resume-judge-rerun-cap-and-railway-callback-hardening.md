# 2026-04-18 — Resume Judge rerun cap and Railway callback hardening

**Scope:** Stop repeated Resume Judge reruns on the same draft, preserve per-draft run counts across callback misses, and harden Railway worker callback delivery after production callback failures.

## What changed

- Added a backend Resume Judge rerun cap of three queued runs for the same draft and job context.
- Persisted `resume_judge_result.run_attempt_count` separately from model/provider `attempt_count` so UI and backend can enforce the rerun limit even when worker callbacks miss.
- Preserved `run_attempt_count` across queued, running, succeeded, failed, stale-draft, and stale-job-context Resume Judge states.
- Updated the application detail page to disable Resume Judge reruns and show a terminal message after the third failed run for the current draft.
- Hardened the worker callback client to try Railway-safe backend URL candidates when the configured callback URL still points at the stale internal `:8000` backend address.
- Verified in Railway that production `agents` was configured with a stale `BACKEND_API_URL` using the internal `:8000` port while the backend process was listening on `8080`.

## Verification

- `python3 -m pytest agents/tests/test_worker.py -q`
- `python3 -m pytest backend/tests/test_phase1_applications.py -q`
- `frontend/npm test -- --run src/test/applications.test.tsx -t "renders a failed judge card with retry in the left rail"`
- `frontend/npm test -- --run src/test/applications.test.tsx -t "disables re-evaluation after three failed judge runs for the current draft"`

## Notes

- A full `frontend/src/test/applications.test.tsx` run still reports unrelated existing failures in notification and progress-polling tests outside the Resume Judge change surface, so the targeted Judge tests were used for regression verification here.
