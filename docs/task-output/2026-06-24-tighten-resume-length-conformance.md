# Tighten Resume Length Conformance

## Summary

Implemented stricter source-aware resume length enforcement so full initial generation and full regeneration can no longer routinely accept drafts that are shorter than the selected target when the source resume has enough grounded material.

## Changes

- Updated shared agent/backend length policy:
  - Source-rich full drafts must meet the selected target minimum.
  - Sparse-source full drafts may pass below target only at or above `floor(source_words * 0.90)`.
  - The assessment now exposes `minimum_acceptable_words`, `underfilled`, and `source_limited_allowed`.
- Added length validation modes:
  - Full generation/full regeneration enforce underfill.
  - Keyword optimization preserves minimal-edit behavior and skips underfill repair.
  - Single-section regeneration skips full-draft underfill checks.
- Strengthened generation and repair prompts with source word count, minimum acceptable words, source-limited allowance, and grounded expansion guidance.
- Added count-based source-limited warnings near the resume preview and in existing status warning surfaces.
- Added sanitized length diagnostics to generation/regeneration success and validation-failure activity metadata.

## Validation

- `python3 -m pytest agents/tests/test_generation_pipeline.py agents/tests/test_worker.py agents/tests/test_resume_judge.py -q`
- `python3 -m pytest backend/tests/test_phase1_applications.py -q`
- `cd frontend && npm run test -- --run src/test/applications.test.tsx`
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
- `git diff --check`
