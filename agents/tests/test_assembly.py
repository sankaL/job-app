from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from assembly import assemble_resume


def test_assemble_resume_tolerates_null_personal_info_fields():
    result = assemble_resume(
        personal_info={
            "name": "Alex Example",
            "email": "alex@example.com",
            "phone": None,
            "address": None,
            "linkedin_url": "https://linkedin.com/in/alex",
        },
        generated_sections=[
            {"name": "summary", "content": "## Summary\nBuilt backend systems."},
        ],
    )

    assert result.startswith("# Alex Example\n")
    assert "alex@example.com | in/alex" in result
    assert "## Summary\nBuilt backend systems." in result
