from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from assembly import assemble_resume


def test_assemble_resume_tolerates_null_personal_info_fields():
    result = assemble_resume(
        personal_info={
            "name": None,
            "email": "alex@example.com",
            "phone": None,
            "address": None,
        },
        generated_sections=[
            {"name": "summary", "content": "## Summary\nBuilt backend systems."},
        ],
    )

    assert result.startswith("# (Name)\n")
    assert "alex@example.com" in result
    assert "## Summary\nBuilt backend systems." in result
