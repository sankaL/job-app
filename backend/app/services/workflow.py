from __future__ import annotations

from typing import Optional


NEEDS_ACTION_STATES = {"manual_entry_required", "duplicate_review_required"}
DRAFT_STATES = {"extraction_pending", "extracting", "generation_pending", "generating"}
IN_PROGRESS_STATES = {"regenerating_section", "regenerating_full", "export_in_progress"}


def derive_visible_status(
    *,
    internal_state: str,
    failure_reason: Optional[str],
    has_successful_export: bool = False,
    draft_changed_since_export: bool = False,
) -> str:
    if failure_reason or internal_state in NEEDS_ACTION_STATES:
        return "needs_action"

    if internal_state in DRAFT_STATES:
        return "draft"

    if internal_state == "resume_ready" and has_successful_export and not draft_changed_since_export:
        return "complete"

    # Resume is ready for review but hasn't been exported yet
    if internal_state == "resume_ready":
        return "needs_action"

    if internal_state in IN_PROGRESS_STATES:
        return "in_progress"

    return "draft"

