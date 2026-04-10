# Task Output — New Application Modal and Optional Pasted-Text Intake

**Date:** 2026-04-09 20:22:31 EDT  
**Scope:** Replace the inline applications-page intake card with a URL-first modal, allow optional pasted source text during creation, and keep frontend, backend, tests, and docs aligned.

## Summary

- Replaced the inline `Create New Application` card on the applications page with a dedicated modal-based intake flow.
- Kept the modal URL-first while adding a secondary reveal action that shows the pasted job-description textarea only when the user asks for it.
- Extended `POST /api/applications` so `{ job_url, source_text }` can create a new application and queue extraction directly from pasted source content.

## Delivered Outcomes

- Users now create new applications from a visually richer modal instead of a collapsible card at the top of the page.
- The pasted-text helper path is available during creation instead of only after extraction failure recovery.
- The create contract stays schema-compatible because `job_url` remains required and attached even when pasted text is supplied.

## Verification

- Backend: `./.venv/bin/pytest tests/test_phase1_applications.py -q`
- Frontend: `npm test -- --run src/test/applications.test.tsx`
