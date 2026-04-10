# Task Output — Deterministic Regeneration, Timeout Profile Update, and Full-Regeneration Cap

**Date:** 2026-04-10  
**Scope:** AI/BE/FE/Docs  
**Status:** Completed

## Summary

Implemented deterministic Professional Experience structure handling for generation and regeneration, switched generation model defaults to higher-quality slower models, extended generation timeout profiles, and enforced a hard non-admin full-regeneration cap per application.

## Key Changes

1. Deterministic Professional Experience contract
- Added `agents/experience_contract.py` with deterministic parsing, anchor extraction, normalization, and contract validation helpers.
- Generation and section-regeneration payloads now include `professional_experience_structure_contract` with source anchors and invariants.
- Added post-LLM normalization to rehydrate Professional Experience company/date from source anchors before validation/assembly.
- Added deterministic validation checks for Professional Experience structure violations.

2. Timeout and progress-stage updates
- Updated generation/worker/backend timeout profiles:
  - Full generation/full regeneration: `240s`
  - Section regeneration: `120s`
- Added more concrete generation stage messaging across prep, model generation, deterministic structure pass, parsing, validation, and assembly phases.

3. Full regeneration cap with admin bypass
- Added additive schema field `applications.full_regeneration_count` with non-negative constraint.
- Enforced a non-admin cap of `3` full regenerations per application.
- Implemented admin bypass via `profile.is_admin`.
- Slot consumption occurs when full regeneration is successfully queued.
- Added user-safe conflict guidance message instructing users to contact an administrator when capped.

4. Model defaults
- Updated generation defaults in env files:
  - Primary: `z-ai/glm-5.1`
  - Fallback: `anthropic/claude-sonnet-4.6`
- Extraction model configuration remains unchanged.

## Schema/Migration

- Added migration: `supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql`
  - Adds `applications.full_regeneration_count integer not null default 0`
  - Adds check constraint enforcing non-negative values

## Tests Added/Updated

- Agents
  - Added `agents/tests/test_experience_contract.py` for anchor extraction, normalization, and contract validation behavior.
  - Updated generation pipeline tests for new prompt contract input and staged progress messaging.

- Backend
  - Added regeneration-cap tests for non-admin block, admin bypass, queue-success slot consumption, and queue-failure non-consumption.
  - Added API-level conflict test for full-regeneration cap response.
  - Updated stalled-generation recovery timing test expectations to match new timeout profile.

- Frontend
  - Added UI test for full-regeneration cap conflict guidance.
  - Added UI test verifying backend generation stage messages are rendered during active progress polling.

## Documentation Updated

- `docs/prompts.md`
- `docs/resume_builder_PRD_v3.md`
- `docs/database_schema.md`
- `docs/backend-database-migration-runbook.md`
- `docs/build-plan.md`
- `docs/decisions-made/decisions-made-1.md`
- `backend/AGENTS.md`

## Notes

- Existing unrelated workspace changes were preserved and not reverted.
