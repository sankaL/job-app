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


def test_privacy_preserves_first_section_and_removes_complete_contact_block():
    from privacy import sanitize_resume_markdown
    source = '## Contact Information\nAlex Example\n45 Main Street\nalex@example.com\n\n## Volunteer Work\nMaintained Community Tools.\n\n## Skills\nPython, FastAPI\n'
    result = sanitize_resume_markdown(source)
    assert 'Alex Example' not in result.sanitized_markdown
    assert '45 Main Street' not in result.sanitized_markdown
    assert 'Maintained Community Tools.' in result.sanitized_markdown
    assert 'Python, FastAPI' in result.sanitized_markdown
    skills = sanitize_resume_markdown('## Skills\nPython, FastAPI\n')
    assert skills.sanitized_markdown == '## Skills\nPython, FastAPI\n'
