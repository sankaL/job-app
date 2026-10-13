# Export styles and download file names

**Date:** 2026-10-12 EDT  
**Status:** Deployed to production 2026-10-13 EDT (commit `14d62f1`)

## What changed

### Backend
- `app/services/export_styles.py`: a registry of five single-column styles (`classic`, `modern`, `compact`, `executive`, `minimal`). Each style sets typography, colour, header and heading treatment, spacing, and the auto-fit starting preset. `resolve_style` fails closed on unknown keys.
- `app/services/pdf_export.py`:
  - The renderers take a `style`. Classic HTML is byte-identical to the previous output; other styles append an override block and `@font-face` rules for bundled fonts.
  - Compact starts at preset index 4 and skips the one-page "roomier" expansion.
  - DOCX applies the style's font, accent colour, alignment, heading case and small caps, and rules.
- `app/assets/fonts/`: OFL Latin subsets of Carlito, Source Sans 3, EB Garamond and Lato (see `LICENSES.md`). The backend image only had DejaVu.
- `app/services/export_filename.py`:
  - Template validation and rendering for file names.
  - The default is `{first name} {last name} Resume`.
  - Content-Disposition carries an ASCII fallback plus `filename*`.
- `application_manager._export_resume`:
  - Resolves the style: request, then saved profile style, then Classic.
  - Builds the name from the source-snapshot base resume's template.
  - Saves the last-used style on success and records `style` in usage-event details.
- API:
  - `GET /api/export-styles` (authenticated).
  - `?style=` on `export-pdf` and `export-docx`.
  - `export_filename_template` on base-resume create, upload (form field), update and detail.
  - `export_style` on profile responses.
  - CORS exposes `Content-Disposition`.
- Migration `20261012_000025_export_styles_and_filenames.sql`.

### Frontend
- `components/applications/ExportResumeModal.tsx`:
  - Style radio-group cards with thumbnails from `public/export-styles/*.png`.
  - Arrow-key navigation, a format toggle and a file-name preview.
  - Errors stay inside the dialog.
- `ApplicationDetailPage`: one "Export…" menu item opens the dialog. After an export, the bootstrap profile refreshes so the last-used style is current. The fallback download name is now `Resume.<ext>`.
- `components/resume/ExportFilenameModal.tsx` + `ExportFilenameField.tsx`: a **File Name** header button (also in the phone More menu) on the base resume editor and upload page opens a dialog. It has placeholder chips, a live example and inline validation. Apply updates the editor state, which counts as unsaved changes; the page save persists it. Saving from the dialog directly was avoided because it would bump the resume revision under unsaved section edits.
- `lib/exportFilename.ts`: mirrors the backend naming rules for previews. The server header stays authoritative.

## Verification
- `make test-backend`: 557 passed. New tests:
  - `test_export_filename.py`
  - In `test_pdf_export.py`: Classic matches unstyled HTML, every style renders PDF and DOCX, fonts exist, unknown style fails.
  - In `test_phase1_applications.py`: style remembered, unknown style 400 without a failure notification, base-resume template with deleted-resume fallback, exact Content-Disposition, `/api/export-styles` auth.
  - In `test_base_resume_service.py`: template validation.
- `make test-frontend`: 330 passed. Covered:
  - The Export dialog (default Classic, DOCX toggle, file-name preview, `style` passed to the API, closes on success; Modern selection for PDF).
  - The base resume file-name field (unknown placeholder blocks save, chips insert placeholders, the saved payload carries the template).
- Thumbnails were rendered in the backend container and checked visually.
- Not run: the guarded browser export check (`make test-browser-export`). It needs the browser stack mode, and the shared dev stack was in use by another session. DOCX output for each style was checked structurally in tests but not opened in Word.

## Regenerating thumbnails
After changing a style, run `python scripts/render_export_style_thumbnails.py <dir>` in the backend container and copy the PNGs into `frontend/public/export-styles/`.

## Code review follow-up (2026-10-13)
- Fixed:
  - The style-preference write is best-effort, with a sanitized warning.
  - File names keep combining marks (Devanagari, Sinhala, Tamil, Thai) and avoid Windows reserved names; Python and TypeScript stay in parity.
  - The dialog closes before the post-export refresh, so a refresh failure can't prompt a duplicate download.
  - The education-years default is now recorded in the PRD and decisions log.
- Added tests:
  - Upload rejects an invalid template.
  - A stale saved style falls back to Classic.
  - A failed export keeps the saved style.
  - The migration constraint matches the style registry.
  - TypeScript filename parity.
  - Export dialog: preselection, keyboard, load failure and error display.
- Left as intentional: no timestamps in file names (identical names on repeat exports; the browser adds a suffix).

## Release
- Migration 025 was applied to production before the push.
- Deploy run `38346137336` succeeded for all three services.
- Verification is recorded in the migration runbook.
