# Task Output — Resume Export Header, LinkedIn Profile Data, and PDF Page-Fit

**Date:** 2026-04-09 20:18:29 EDT  
**Scope:** Fix duplicate or placeholder resume export headers, add profile-managed LinkedIn support, enforce missing-name recovery for generation and export, and tighten PDF rendering toward the saved page-length target.

## Summary

- PDF export now renders one normalized profile-driven header instead of stacking an HTML header on top of the assembled Markdown header.
- Profiles now support `linkedin_url`, and export treats the existing `address` field as the displayed location line.
- Initial generation, full regeneration, and PDF export now fail closed with actionable guidance when the user has not filled in a profile name.
- Export now reads the saved `generation_params.page_length` value and retries tighter WeasyPrint presets to better match the requested PDF page count.

## Delivered Outcomes

- Added `profiles.linkedin_url` through the schema migration, backend profile API, frontend profile types, and the profile form.
- Updated local resume assembly to emit contact info in the order `email | phone | location | linkedin` and removed the `# (Name)` placeholder path.
- Rebuilt the PDF export renderer to normalize legacy header blocks, render a centered reference-style header, preserve normal Markdown content, right-align common pipe-delimited date and location rows, and retry progressively tighter layout presets before giving up.
- Added backend regression coverage for the new profile API field, missing-name generation/export failures, header normalization, and autofit preset retries.
- Added frontend regression coverage for saving the relabeled `Location` field together with the new `LinkedIn` field on the profile page.

## Verification

- Python syntax: `PYTHONPYCACHEPREFIX=/tmp/codex-pyc python3 -m py_compile backend/app/services/pdf_export.py backend/app/services/application_manager.py backend/app/api/profiles.py backend/app/db/profiles.py backend/app/api/session.py agents/assembly.py backend/tests/test_pdf_export.py backend/tests/test_profiles_api.py backend/tests/test_phase1_applications.py backend/tests/test_session_bootstrap.py`
- Backend tests: `backend/.venv/bin/pytest backend/tests/test_pdf_export.py backend/tests/test_profiles_api.py backend/tests/test_session_bootstrap.py backend/tests/test_phase1_applications.py -q`
- Frontend tests: `npm test -- --run frontend/src/test/applications.test.tsx`
- Frontend build: `npm run build`
