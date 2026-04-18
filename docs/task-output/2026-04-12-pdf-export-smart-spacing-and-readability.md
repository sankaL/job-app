# Task Output — PDF Export Smart Spacing and Readability

**Date:** 2026-04-12 12:32:05 EDT  
**Scope:** Improve resume PDF export readability by increasing key spacing, adding light content-density adjustments, fixing bullet-item parsing edge cases, and raising the minimum readable autofit floor.

## Summary

- PDF export now gives the profile header, section headings, subheadings, and bullet lists more breathing room without changing the service API.
- The renderer now applies small spacing adjustments based on overall document density so sparse resumes do not look cramped and dense resumes do not waste vertical space.
- Bullet-item rendering now unwraps accidental nested single-item list markup while preserving literal `*` content such as `*nix`.
- The autofit ladder now bottoms out at `9.4pt` body text and `1.10` line height instead of the previous smaller fallback.

## Delivered Outcomes

- Expanded the `LayoutPreset` spacing model in `backend/app/services/pdf_export.py` with dedicated contact-to-section, section-heading, subheading, and bullet-indent primitives.
- Rebalanced the preset ladder to keep the density-first strategy while removing the unreadable `8.8pt` / `1.02` fallback.
- Added `_calculate_content_density_metrics()` and used it to adjust rendered spacing for `dense`, `balanced`, and `sparse` documents.
- Replaced bullet-item inline rendering with a safer helper that unwraps nested single-item list wrappers instead of stripping leading asterisks from raw text.
- Extended backend regression coverage for CSS spacing output, density classification, list-item edge cases, and readable preset floors.

## Verification

- Python syntax: `PYTHONPYCACHEPREFIX=/tmp/codex-pyc python3 -m py_compile backend/app/services/pdf_export.py backend/tests/test_pdf_export.py`
- Backend tests: `backend/.venv/bin/pytest backend/tests/test_pdf_export.py -q`
