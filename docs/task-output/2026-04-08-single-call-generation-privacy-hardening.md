# Task Output — Single-Call Generation, Privacy Hardening, and Async Reliability

**Date:** 2026-04-08 08:39:33 EDT  
**Scope:** Replace multi-call resume generation with a single-call structured pipeline, keep personal contact data out of external LLM prompts, harden async generation handling, and add regression coverage.

## Summary

- Replaced section-by-section generation plus LLM validation with one structured OpenRouter call per resume-writing action and deterministic local validation before assembly.
- Added reusable resume sanitization so contact headers, emails, phone numbers, addresses, and contact links are removed before external LLM calls and reattached locally afterward.
- Hardened worker and backend async behavior with callback retries, stale-job progress fencing, and terminal-state reconciliation to stop late updates from reviving failed or cancelled jobs.
- Fixed frontend regeneration settings hydration so saved page length, aggressiveness, and instructions come back from the latest draft instead of silently falling back to UI defaults.

## Delivered Outcomes

- Initial generation and full regeneration now request ordered JSON sections in one call and only attempt a second model when the first request fails or returns invalid structured output.
- Single-section regeneration now uses one sanitized model call scoped to the selected section and deterministic local validation before patching the draft.
- Upload-time resume cleanup still exists, but it now formats only sanitized resume content and restores the header locally after the model returns.
- Validation now fails closed on invalid JSON, missing sections, wrong order, ATS-unsafe Markdown, contact-data leakage, unsupported grounding snippets, and unsupported date drift.
- Backend progress reads now prefer terminal database state over stale non-terminal Redis progress when the application has already failed or completed.

## Verification Added

- Worker tests for single-call generation behavior, fallback only after failure or invalid JSON, stale progress fencing, and callback retry backoff.
- Backend tests for sanitized upload cleanup and for preferring terminal application state over stale active progress.
- Frontend test for hydrating saved generation settings from the latest draft.

## Files Touched

- `agents/generation.py`
- `agents/privacy.py`
- `agents/validation.py`
- `agents/worker.py`
- `backend/app/services/application_manager.py`
- `backend/app/services/resume_parser.py`
- `backend/app/services/resume_privacy.py`
- `frontend/src/routes/ApplicationDetailPage.tsx`
- `frontend/src/routes/BaseResumeEditorPage.tsx`
- `agents/tests/test_generation_pipeline.py`
- `agents/tests/test_worker.py`
- `backend/tests/test_phase1_applications.py`
- `backend/tests/test_resume_parser.py`
- `frontend/src/test/applications.test.tsx`
