from app.core.workflow_contract import get_workflow_contract


def test_workflow_contract_has_complete_status_mapping():
    contract = get_workflow_contract()

    assert [status["id"] for status in contract.visible_statuses] == [
        "draft",
        "needs_action",
        "in_progress",
        "complete",
    ]
    assert "export_in_progress" in contract.internal_states
    assert set(contract.failure_reasons) == {
        "extraction_failed",
        "generation_failed",
        "regeneration_failed",
        "export_failed",
    }
    assert "job_id" in contract.polling_progress_schema.required
