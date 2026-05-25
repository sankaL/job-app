# Activity Log Diagnostics and Judge Feedback Differentiation

**Date:** 2026-05-25 17:15:00 EDT
**Status:** Completed

## Summary

Differentiated "Regeneration with Judge Feedback" from standard full regeneration across titles, summaries, and metadata details. Additionally, enriched the Activity Log timeline with extraction/LLM model names, extraction/LLM durations, user-provided instructions, and Resume Judge recommendations.

## What Changed

- **Judge-Feedback Differentiation**:
  - Added `use_judge_feedback` request setting and passed it through the api full regeneration route.
  - Persisted `use_judge_feedback` inside the draft's `generation_params` dictionary.
  - At worker callback, parsed `use_judge_feedback` and recorded specialized timeline event title (`"Regeneration with Judge Feedback started"`, `"Regeneration with Judge Feedback completed"`) and custom summaries instead of general regeneration copy.
- **Model and Duration Enrichment**:
  - Enhanced `OpenRouterExtractionAgent.extract()` to return a tuple `(ExtractedJobPosting, model_used)` to capture the successfully invoked model.
  - Updated extraction job callbacks to receive `model_used` and attach it to the succeeded payload.
  - Calculated `duration_ms` at completion of extraction, and recorded both `model_used` and `duration_ms` inside the activity details.
  - Enriched completed regeneration events with the `model_used` and duration details.
- **Specific Instructions & Judge Recommendations**:
  - Persisted user-supplied prompt instructions under `"additional_instructions"` (full regeneration) or `"instructions"` (section regeneration) inside activity log events.
  - Attached specific Judge Recommendations (`regeneration_instructions`) inside `resume_judge_succeeded` and downstream regeneration timeline event details.
- **Timeline UI Improvements**:
  - Updated `ApplicationActivityPanel.tsx`'s `hasExpandableDetails` function to recognize when specific instructions or judge feedback recommendations exist in both started and succeeded events.
  - Rendered `Specific Instructions` and `Judge Recommendations` in elegant, blockquote-style timeline detail blocks using cohesive spruce/ember theme tokens.
  - Integrated the `useJudgeFeedback` parameter into the frontend trigger API and updated the detail page's judge dialog buttons to send it.
- **Test Integrity**:
  - Updated mock extraction stubs and assertions in `agents/tests/test_worker.py` to expect and support the `(ExtractedJobPosting, model_used)` tuple.
  - Fixed vitest expectations in `frontend/src/test/applications.test.tsx` to verify `"use_judge_feedback": true` is passed correctly in trigger parameters.

## Validation

- Backend tests passed: `pytest backend/tests/test_phase1_applications.py agents/tests/test_worker.py`
- Frontend tests passed: `npm run test` (123 tests passing successfully)
