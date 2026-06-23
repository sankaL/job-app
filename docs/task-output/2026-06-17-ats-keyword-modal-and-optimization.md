# ATS Keyword Modal And Targeted Optimization

Date: 2026-06-17

## Summary

- Replaced the application-detail ATS keyword inline expansion with a modal patterned after Resume Judge.
- Added persisted manual keywords to the existing `applications.job_keywords` JSONB contract.
- Added deterministic exact-match coverage across extracted and manual keywords.
- Added a quota-consuming keyword optimization regeneration target that uses the user's selected generation tier, targets missing keywords, preserves matched keywords, and keeps the previous draft if coverage regresses.

## Implementation Notes

- Manual keywords are capped at 30 phrases and 80 characters per phrase, normalized for whitespace, and deduped case-insensitively.
- Extraction reruns replace extracted keywords while preserving manual keywords.
- Keyword optimization receives `target_keywords`, `preserve_keywords`, `starting_match`, and sanitized current-draft context.
- Private current-draft snapshot content is stripped from persisted draft generation parameters.
- Keyword optimization is warn-only for target percentage misses but fail-closed if matched keyword count decreases.

## Verification

- `python3 -m py_compile backend/app/services/application_manager.py backend/app/api/applications.py agents/worker.py agents/generation.py backend/tests/test_phase1_applications.py agents/tests/test_worker.py agents/tests/test_generation_pipeline.py`
- `npm run build -- --mode test`
- `python3 -m pytest backend/tests/test_phase1_applications.py -q`
- `python3 -m pytest agents/tests/test_worker.py agents/tests/test_generation_pipeline.py -q`
- `npm test -- src/test/applications.test.tsx`
