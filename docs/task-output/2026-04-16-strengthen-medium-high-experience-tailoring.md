# 2026-04-16 — Strengthen Medium/High Professional Experience Tailoring

**Scope:** Make medium/high resume tailoring visibly change Professional Experience by default, restore bounded reasoning defaults, extend review flags to experience title rewrites, and keep docs/tests aligned.

## What changed

- Kept generation/regeneration reasoning bounded and repair non-reasoning.
- Follow-up note on 2026-04-16: generation and regeneration reasoning effort is now env-configurable through `GENERATION_AGENT_REASONING_EFFORT`, and the tracked defaults currently set it to `none`.
- Rewrote medium/high Professional Experience prompt contracts so that section is the primary tailoring surface, with fixed source role order and visible bullet rewrites in the first up to two roles that contain bullets.
- Added a new validation failure type, `insufficient_experience_tailoring`, so medium/high runs fail closed when Professional Experience stays too close to the source.
- Passed that new validation failure through the repair prompt so repair attempts explicitly target Professional Experience instead of only Summary or Skills.
- Expanded draft `review_flags` detection so medium/high Professional Experience title/header rewrites with JD-only wording are surfaced under the existing payload shape.

## Verification

- `backend/.venv/bin/python -m pytest agents/tests/test_generation_pipeline.py -q`
- `backend/.venv/bin/python -m pytest agents/tests/test_worker.py -q -k 'validate_generated_sections_with_repair_passes_through_insufficient_experience_tailoring'`
- `backend/.venv/bin/python -m pytest backend/tests/test_phase1_applications.py -q -k 'review_flags'`

## Notes

- A full run of `backend/tests/test_phase1_applications.py` still has an existing environment failure unrelated to this task because `python-docx` is missing in the local backend venv.
- A full run of `agents/tests/test_worker.py` still has an existing dirty-tree mismatch unrelated to this task: `test_backend_callback_client_retries_transient_server_errors` expects three callback attempts while the current code is configured for two.
