# ATS keyword extraction and match metrics

**Date:** 2026-06-15 22:05:00 EDT  
**Scope:** Add job-specific exact keyword extraction, deterministic draft coverage, generation prompt guidance, and application-detail visibility.

## Summary

- Added nullable `applications.job_keywords` JSONB storage for keyword extraction lifecycle state.
- Added a worker keyword extractor that returns ordered exact job-description phrases and post-filters them deterministically against the current job description.
- Queued keyword extraction after URL extraction, pasted-description extraction, manual entry, recovery extraction, and later job-description edits.
- Added backend draft coverage metrics with case-insensitive exact phrase matching only.
- Passed keyword phrases and Low/Medium/High coverage targets into initial generation, full regeneration, and section regeneration prompts as warn-only guidance.
- Added an application-detail ATS Keywords panel that is collapsed by default and expands to show matched and missing exact phrases.

## Implementation Notes

- Coverage targets are Low 45%, Medium 65%, and High 80%, with no upper limit.
- Keyword extraction failures do not change application status and do not block generation, regeneration, editing, Resume Judge, or export.
- Coverage is recomputed on draft reads and draft saves from the latest Markdown content.
- Stale worker callbacks are ignored by user ownership, job id, source hash, and current job-description hash.

## Verification

- `python3 -m pytest backend/tests/test_phase1_applications.py -q`
- `python3 -m pytest agents/tests/test_worker.py agents/tests/test_generation_pipeline.py -q`
- `npm test -- src/test/applications.test.tsx`
- `npm run build -- --mode test`
