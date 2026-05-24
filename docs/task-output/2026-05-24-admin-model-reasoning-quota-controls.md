# Admin Model Reasoning and Quota Controls

**Date:** 2026-05-24 00:20:00 EDT  
**Status:** Completed

## Summary

Added admin-controlled OpenRouter model and reasoning settings per subscription tier, plus dashboard visibility into each user's remaining monthly resume-writing requests.

## What Changed

- Added curated model choices for Gemini 3 Flash, GPT 5.4 Mini, and Gemini 3.5 Flash.
- Added model-aware reasoning controls for primary and fallback tier models.
- Extended subscription tiers with primary/fallback reasoning fields and compatibility constraints.
- Passed tier-selected model and reasoning settings into generation, regeneration, section regeneration, and validation repair jobs.
- Added session-bootstrap quota status and a dashboard card showing requests left, used count, tier, and reset date.
- Returned sanitized `quota_exhausted` errors when monthly usage is depleted.
- Updated schema, PRD, prompt catalog, migration runbook, and build-plan documentation.

## Validation

- Frontend production build passed.
- Focused frontend admin subscription and dashboard quota tests passed.
- Focused backend admin/session/application quota/migration tests passed after installing declared backend dev dependencies into `backend/.venv`.
- Agent worker/generation regression tests passed.
- The full frontend applications test file still has unrelated existing failures in notifications, breadcrumbs, immersive compare setup, and stopped-extraction assertions.

## Review Follow-ups

**Date:** 2026-05-24 12:01:00 EDT

- Failed generation and regeneration callbacks now carry `quota_period_start` and refund the reserved monthly quota for that exact period.
- The worker rejects unsupported tier model IDs and model/reasoning combinations before calling OpenRouter.
- Worker model resolution now treats `None` tier model values as blank instead of the literal string `"None"`.
- Frontend API helpers now normalize object-shaped error details consistently.
- Admin tier/user inputs now enforce subscription tier and monthly limit constraints earlier.
- Added focused regression coverage for model catalog validation, worker model/reasoning resolution, quota refund callbacks, and non-admin subscription-tier updates.
