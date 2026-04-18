# Task Output — Medium/High JD Keyword Injection and Draft Review Flags

**Date:** 2026-04-15 21:20:00 EDT  
**Scope:** AI/BE/FE/Docs  
**Status:** Completed

## Summary

Implemented a generation-behavior update so medium and high aggressiveness can perform stronger job-description alignment, and added explicit review surfacing for medium/high additions that are not explicit in the base resume.

## Key Changes

1. Generation aggressiveness contracts
- Updated `agents/generation.py` so medium/high allow JD-driven non-factual keyword and skill phrasing.
- Kept low mode source-preserving behavior.
- Preserved deterministic Professional Experience company/date invariants and title constraints by aggressiveness.

2. Mode-differentiated generation variance
- Added aggressiveness-based sampling temperatures:
  - `low=0.2`
  - `medium=0.35`
  - `high=0.5`
- Applied across generation, regeneration, and repair flows.

3. Draft review flags
- Added read-time `review_flags` generation in backend application service for medium/high drafts.
- Added `review_flags` to `GET /api/applications/{application_id}/draft` response payload.
- Added detail-page UI panel to show flagged additions for explicit user verification.

4. UI copy alignment
- Updated aggressiveness popover and warning copy to reflect medium/high keyword-skill injection behavior and review expectations.

## Verification

- `python3 -m pytest agents/tests/test_generation_pipeline.py -q`
- `cd backend && python3 -m pytest tests/test_phase1_applications.py -q`
- `cd frontend && npx vitest run src/test/applications.test.tsx -t "shows detailed aggressiveness help in compact popovers|shows flagged job-description additions in generated draft review panel"`

## Notes

- Full `frontend/src/test/applications.test.tsx` still includes a pre-existing unrelated failure (`renders top-aligned application table cells for the compact list layout`) when running the entire file; targeted tests for this task pass.
