# Task Output — Generation Reliability, Bounded Retries, and Diagnostics

**Date:** 2026-04-14 21:34:11 EDT  
**Scope:** AI/BE/FE/Docs  
**Status:** Completed

## Summary

Implemented the generation reliability plan by replacing the old retry fan-out with a bounded primary/fallback pipeline, adding one validation-aware repair pass, enriching sanitized diagnostics across frontend/backend/worker paths, surfacing frontend blocker reasons when generation never starts, and moving generation defaults to faster lighter models.

## Key Changes

1. Bounded generation and regeneration attempts
- Full generation and full regeneration now use one primary structured-output attempt followed by one fallback prompt-level JSON attempt.
- Same-model retry is now limited to explicit provider rejection of the `reasoning` parameter.
- Section regeneration keeps the same bounded pattern with reduced reasoning intensity.

2. Validation-aware repair path
- Added one repair-only prompt path that runs after deterministic validation failure.
- Repair uses sanitized validation summaries plus the original response contract and prior response payload.
- The workflow still fails closed if the repair output remains invalid.

3. Diagnostics and failure detail expansion
- Added structured route-entry and enqueue logging in backend generation and regeneration handlers.
- Added worker logs for job start, LLM attempts, validation/repair outcomes, cache writes, callback delivery, and terminal failure classification.
- Expanded `generation_failure_details` with sanitized `failure_stage`, `attempt_count`, `attempts`, `terminal_error_code`, and repair metadata.
- Added frontend request-start/request-failure logging and compact diagnostics rendering in failure cards.

4. Frontend blocked-start handling
- Replaced silent generate/regenerate early returns with explicit blocker computation.
- Surfaced actionable inline messages when base resume selection, job details, duplicate resolution, or other prerequisites block a request before the backend call.

5. Model and reasoning policy updates
- Updated local/runtime defaults to:
  - `GENERATION_AGENT_MODEL=openai/gpt-5-mini`
  - `GENERATION_AGENT_FALLBACK_MODEL=google/gemini-flash-1.5`
- Follow-up note on 2026-04-16: reasoning effort is now env-configurable through `GENERATION_AGENT_REASONING_EFFORT`, and the tracked defaults currently set it to `none`.

## Verification

- `python3 -m pytest agents/tests/test_generation_pipeline.py -q`
- `cd backend && python3 -m pytest tests/test_phase1_applications.py -q`
- `cd frontend && npx tsc --noEmit`

## Known Limitation

- `python3 -m pytest agents/tests/test_worker.py -q` could not run in this environment because `agents/worker.py` imports `playwright.async_api` and the local Python environment does not have `playwright` installed.

## Documentation Updated

- `docs/prompts.md`
- `docs/build-plan.md`
- `docs/decisions-made/decisions-made-1.md`
