# Semantic Resume Agent Output

Date: 2026-05-25 18:49:35 EDT

## Summary

Replaced Markdown-in-section resume-writing agent output with strict semantic JSON content contracts. The backend now renders Markdown locally from typed section content, while preserving Markdown as the persisted draft format for preview, editing, PDF export, and DOCX export.

## Implemented

- Added semantic section schemas for Summary, Professional Experience, Education, Skills, Projects, and Certifications.
- Added source-section eligibility detection so generation requests only include user-enabled sections supported by the sanitized base resume.
- Rendered semantic JSON to canonical Markdown locally before existing assembly/export flows.
- Updated validation repair to preserve and repair the same semantic JSON contract.
- Changed Resume Judge regeneration guidance to section-keyed JSON and formatted it for UI/activity display and judge-feedback regeneration.
- Tightened job extraction and resume cleanup prompt/output contracts.
- Updated product, schema, prompt, build-plan, decision-log, and agent guidance docs.

## Verification

- `python3 -m pytest agents/tests -q`
- `python3 -m pytest backend/tests/test_application_request_validation.py backend/tests/test_base_resume_service.py backend/tests/test_resume_parser.py -q`
- `npm test -- --run src/test/applications.test.tsx src/test/resume-render-preview.test.tsx`
- `npm run build`

## Code Review Follow-Up

Date: 2026-05-26 10:03:29 EDT

- Kept old Markdown/string response rejection as an intentional fail-closed contract boundary.
- Kept summary eligibility from substantive non-contact source content because it is part of the approved semantic-output plan.
- Added normalization for semantic section-map fallback payloads that provide raw content objects plus section metadata.
- Added compound heading aliases such as `Technical Skills & Proficiencies` and `Certificates & Licenses`.
- Added focused regression coverage for semantic rendering, eligibility failures, section regeneration guards, semantic Professional Experience anchor validation, malformed cleanup payloads, and dict-shaped judge feedback rendering.
