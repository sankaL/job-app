# Task Output — High-Aggressiveness Professional-Experience Title Rewrites

**Date:** 2026-04-09 20:00:24 EDT  
**Scope:** Allow high aggressiveness to rewrite professional-experience role titles for alignment while keeping low and medium title-fixed and preserving deterministic grounding validation.

## Summary

- High aggressiveness now allows Professional Experience role titles to be rewritten when the new title is still a truthful reframing of the same source role.
- Low and medium aggressiveness now explicitly preserve source role titles exactly as written.
- The validator, prompt catalog, PRD, and settings UI now all describe the same high-only title-rewrite rule.

## Delivered Outcomes

- Updated the generation aggressiveness contract so only `high` can retitle Professional Experience roles, with explicit guardrails to keep employer and dates unchanged and to avoid seniority inflation.
- Updated deterministic validation so high-aggressiveness Professional Experience role-title rewrites do not fail as unsupported claims, while unsupported employers, dates, credentials, and other claims still fail closed.
- Updated the configuration-card copy and the inline aggressiveness popover content so users can see that low and medium keep titles fixed and high may rewrite them.
- Updated repo guidance and product docs so the new behavior is documented consistently instead of living only in prompt code.

## Verification

- Python syntax: `PYTHONPYCACHEPREFIX=/tmp/codex-pyc python3 -m py_compile agents/generation.py agents/validation.py`
- Agent tests: `backend/.venv/bin/pytest agents/tests/test_generation_pipeline.py -q`
- Frontend tests: `npm test -- --run src/test/applications.test.tsx`
