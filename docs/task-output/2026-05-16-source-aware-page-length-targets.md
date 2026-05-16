# Source-Aware Page-Length Targets

## Summary

Implemented page length as a source-aware content target for resume generation. Two-page and three-page drafts now get deterministic lower-bound validation based on the selected target and the amount of grounded content available in the base resume.

## Changes

- Added shared agent-side length policy constants for generation, validation, and Resume Judge.
- Strengthened generation and repair prompts so underfilled multi-page drafts expand only by restoring grounded source-resume details.
- Added validation failure for underfilled multi-page drafts below `min(target_min, floor(source_words * 0.80))`.
- Added `source_limited_length` warnings for drafts that are below the nominal target range but above the source-aware minimum.
- Surfaced the source-limited warning in the application detail draft view.
- Kept PDF/DOCX export behavior as max-page fitting rather than artificial visual page filling.
- Updated Resume Judge post-processing to cap length scores and prioritize length feedback for under-target non-source-limited drafts.

## Validation

- `python3 -m pytest agents/tests/test_generation_pipeline.py agents/tests/test_resume_judge.py agents/tests/test_worker.py -q`
- `cd backend && python3 -m pytest tests/test_phase1_applications.py -q`
- `cd frontend && npm test -- --run src/test/applications.test.tsx -t "source-limited length warning"`
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`

The full `frontend/src/test/applications.test.tsx` suite was also run and still has unrelated existing failures around notification count, dashboard failure state, compare-shell provider setup, and duplicate extraction-stopped text.
