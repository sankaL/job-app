# 2026-04-17 — Resume Judge Agent and Score UI

**Scope:** Add a dedicated Resume Judge agent, persist score state on applications, and expose a clickable score tile plus detailed breakdown in the application detail workspace.

## What changed

- Added `agents/resume_judge.py` as a dedicated evaluator module with its own OpenRouter primary/fallback model config, validated reasoning-effort env handling, strict JSON parsing, deterministic ATS/density observations, and local score arithmetic.
- Added worker support for `run_resume_judge_job`, a dedicated internal callback route, and fail-open success or failure payloads that persist judge state without changing the core application workflow state.
- Added `applications.resume_judge_result jsonb` and threaded it through repository reads, writes, API serialization, and detail-page payloads.
- Queued Resume Judge automatically after successful initial generation, full regeneration, section regeneration, and cached generation-result recovery, using the full merged draft for post-section-regeneration scoring.
- Added `POST /api/applications/{application_id}/judge` so stale edited drafts can be re-evaluated on demand.
- Implemented stale-callback fencing by comparing `resume_judge_result.evaluated_draft_updated_at` against the current `resume_drafts.updated_at` value before accepting a callback or treating a score as current.
- Updated the application detail page with:
  - a prominent Resume Judge score tile in the generated-resume header
  - queued/running, failed, stale, and succeeded states
  - a responsive breakdown dialog with exact score, verdict, dimension cards, evaluator notes, and regeneration instructions
  - a stale-draft re-evaluate path
  - a low-score full-regeneration CTA that appends judge feedback below existing user instructions
- Added regression coverage for the judge agent, worker job, backend queue/callback paths, API route, and frontend score or dialog flows.

## Verification

- `python3 -m pytest agents/tests/test_resume_judge.py agents/tests/test_worker.py backend/tests/test_phase1_applications.py -q`
- `frontend/npm test -- --run src/test/applications.test.tsx`
- `frontend/npm run build`

## Notes

- The frontend applications test file still emits existing `recharts` zero-size warnings in jsdom for dashboard chart tests, but the suite passes.
- Resume Judge currently defaults to `openai/gpt-5.4-mini` with `none` reasoning and falls back to `openai/gpt-5-mini`.
