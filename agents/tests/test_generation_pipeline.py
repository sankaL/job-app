from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import generation
from privacy import sanitize_resume_markdown
from validation import validate_resume


class FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


@pytest.mark.asyncio
async def test_generate_sections_uses_single_llm_call_and_sanitized_prompt(monkeypatch):
    calls: list[dict[str, object]] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            calls.append(kwargs)
            self.model = kwargs["model"]

        async def ainvoke(self, prompt):
            human_payload = json.loads(prompt[1][1])
            assert "alex@example.com" not in human_payload["sanitized_base_resume_markdown"]
            assert "linkedin.com/in/alex" not in human_payload["sanitized_base_resume_markdown"]
            return FakeResponse(
                json.dumps(
                    {
                        "sections": [
                            {
                                "id": "summary",
                                "heading": "Summary",
                                "markdown": "## Summary\n- Built backend systems.",
                                "supporting_snippets": ["Built backend systems"],
                            },
                            {
                                "id": "skills",
                                "heading": "Skills",
                                "markdown": "## Skills\n- Python\n- FastAPI",
                                "supporting_snippets": ["Python", "FastAPI"],
                            },
                        ]
                    }
                )
            )

    monkeypatch.setattr(generation, "ChatOpenAI", FakeChatOpenAI)

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content=(
            "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n"
            "## Summary\nBuilt backend systems\n\n## Skills\nPython\nFastAPI\n"
        ),
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs and backend systems.",
        section_preferences=[
            {"name": "summary", "enabled": True, "order": 0},
            {"name": "skills", "enabled": True, "order": 1},
        ],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert [call["model"] for call in calls] == ["primary-model"]
    assert calls[0]["max_retries"] == 0
    assert [section["name"] for section in result["sections"]] == ["summary", "skills"]


@pytest.mark.asyncio
async def test_generate_sections_falls_back_only_after_invalid_primary_response(monkeypatch):
    responses = {
        "primary-model": ["not-json"],
        "fallback-model": [
            json.dumps(
                {
                    "sections": [
                        {
                            "id": "summary",
                            "heading": "Summary",
                            "markdown": "## Summary\n- Built backend systems.",
                            "supporting_snippets": ["Built backend systems"],
                        }
                    ]
                }
            )
        ],
    }
    models_seen: list[str] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.model = kwargs["model"]
            models_seen.append(self.model)

        async def ainvoke(self, _prompt):
            return FakeResponse(responses[self.model].pop(0))

    monkeypatch.setattr(generation, "ChatOpenAI", FakeChatOpenAI)

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert models_seen == ["primary-model", "fallback-model"]
    assert result["model_used"] == "fallback-model"


@pytest.mark.asyncio
async def test_generate_sections_accepts_section_map_payload_without_fallback(monkeypatch):
    models_seen: list[str] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.model = kwargs["model"]
            models_seen.append(self.model)

        async def ainvoke(self, _prompt):
            return FakeResponse(
                json.dumps(
                    {
                        "summary": {
                            "heading": "Summary",
                            "content": "## Summary\n- Built backend systems.",
                            "supporting_snippets": ["Built backend systems"],
                        },
                        "skills": {
                            "heading": "Skills",
                            "content": "## Skills\n- Python\n- FastAPI",
                            "supporting_snippets": ["Python", "FastAPI"],
                        },
                    }
                )
            )

    monkeypatch.setattr(generation, "ChatOpenAI", FakeChatOpenAI)

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content="## Summary\nBuilt backend systems\n\n## Skills\nPython\nFastAPI\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[
            {"name": "summary", "enabled": True, "order": 0},
            {"name": "skills", "enabled": True, "order": 1},
        ],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert models_seen == ["primary-model"]
    assert [section["name"] for section in result["sections"]] == ["summary", "skills"]
    assert result["sections"][0]["content"].startswith("## Summary")


@pytest.mark.asyncio
async def test_generate_sections_truncates_excess_supporting_snippets_without_fallback(monkeypatch):
    models_seen: list[str] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.model = kwargs["model"]
            models_seen.append(self.model)

        async def ainvoke(self, _prompt):
            return FakeResponse(
                json.dumps(
                    {
                        "sections": [
                            {
                                "id": "summary",
                                "heading": "Summary",
                                "markdown": "## Summary\n- Built backend systems.",
                                "supporting_snippets": [f"snippet {index}" for index in range(8)],
                            }
                        ]
                    }
                )
            )

    monkeypatch.setattr(generation, "ChatOpenAI", FakeChatOpenAI)

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert models_seen == ["primary-model"]
    assert result["model_used"] == "primary-model"
    assert len(result["sections"][0]["supporting_snippets"]) == 6


@pytest.mark.asyncio
async def test_generate_sections_falls_back_on_invalid_structured_content(monkeypatch):
    responses = {
        "primary-model": [
            json.dumps(
                {
                    "sections": [
                        {
                            "id": "summary",
                            "heading": "Summary",
                            "markdown": "",
                            "supporting_snippets": ["Built backend systems"],
                        }
                    ]
                }
            )
        ],
        "fallback-model": [
            json.dumps(
                {
                    "sections": [
                        {
                            "id": "summary",
                            "heading": "Summary",
                            "markdown": "## Summary\n- Built backend systems.",
                            "supporting_snippets": ["Built backend systems"],
                        }
                    ]
                }
            )
        ],
    }
    models_seen: list[str] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.model = kwargs["model"]
            models_seen.append(self.model)

        async def ainvoke(self, _prompt):
            return FakeResponse(responses[self.model].pop(0))

    monkeypatch.setattr(generation, "ChatOpenAI", FakeChatOpenAI)

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert models_seen == ["primary-model", "fallback-model"]
    assert result["model_used"] == "fallback-model"


@pytest.mark.asyncio
async def test_regenerate_single_section_accepts_bare_section_payload(monkeypatch):
    models_seen: list[str] = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.model = kwargs["model"]
            models_seen.append(self.model)

        async def ainvoke(self, _prompt):
            return FakeResponse(
                json.dumps(
                    {
                        "heading": "Summary",
                        "content": "## Summary\n- Built backend systems for high-scale APIs.",
                        "supporting_snippets": ["Built backend systems"],
                    }
                )
            )

    monkeypatch.setattr(generation, "ChatOpenAI", FakeChatOpenAI)

    result = await generation.regenerate_single_section(
        current_draft_content="## Summary\n- Built backend systems.\n",
        section_name="summary",
        instructions="Focus more on API scale.",
        base_resume_content="## Summary\nBuilt backend systems\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
    )

    assert models_seen == ["primary-model"]
    assert result["name"] == "summary"
    assert result["content"].startswith("## Summary")


def test_sanitize_resume_markdown_strips_contact_header():
    sanitized = sanitize_resume_markdown(
        "Alex Example\nalex@example.com | (555) 123-4567 | https://linkedin.com/in/alex\n\n"
        "## Summary\nBuilt backend systems.\n"
    )

    assert sanitized.header_lines == [
        "Alex Example",
        "alex@example.com | (555) 123-4567 | https://linkedin.com/in/alex",
    ]
    assert "alex@example.com" not in sanitized.sanitized_markdown
    assert sanitized.sanitized_markdown.startswith("## Summary")


def test_sanitize_resume_markdown_strips_markdown_name_header():
    sanitized = sanitize_resume_markdown("# Jane Doe\n\n## Summary\nBuilt backend systems.\n")

    assert sanitized.header_lines == ["# Jane Doe"]
    assert "# Jane Doe" not in sanitized.sanitized_markdown


def test_sanitize_resume_markdown_preserves_project_urls_in_body():
    sanitized = sanitize_resume_markdown(
        "Jane Doe\njane@example.com | https://linkedin.com/in/jane\n\n"
        "## Projects\n- Demo: https://github.com/acme/tool\n"
    )

    assert "- Demo: https://github.com/acme/tool" in sanitized.sanitized_markdown


@pytest.mark.asyncio
async def test_validate_resume_rejects_contact_leakage_and_unsupported_dates():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nReach me at alex@example.com. Worked from Jan 2024 to Present.",
                "supporting_snippets": ["Built backend systems."],
            }
        ],
        base_resume_content="## Summary\nBuilt backend systems.\n",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page"},
    )

    assert result["valid"] is False
    error_types = {error["type"] for error in result["errors"]}
    assert "pii_leakage" in error_types
    assert "unsupported_date" in error_types


@pytest.mark.asyncio
async def test_validate_resume_accepts_grounded_list_style_skill_snippets():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "skills",
                "heading": "Skills",
                "content": "## Skills\n- SQL\n- Python\n- Java\n- Azure DevOps\n- CI/CD\n- Jenkins",
                "supporting_snippets": [
                    "SQL, Python, Java",
                    "Azure DevOps, CI/CD, Jenkins",
                    "ETL Testing, Database Testing",
                ],
            }
        ],
        base_resume_content=(
            "## Skills\n"
            "- Programming Languages: Python, JavaScript, TypeScript, Java, SQL\n"
            "- Tools & Technologies: Jenkins\n"
            "- Management Tools: Azure DevOps, BitBucket\n"
            "- Methodologies & Standards: Agile, CI/CD\n"
            "- Test Types: Database Testing, ETL Testing\n"
        ),
        section_preferences=[{"name": "skills", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page"},
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "unsupported_snippet" not in error_types


@pytest.mark.asyncio
async def test_validate_resume_rejects_unsupported_role_and_company_claims():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nStaff Engineer at Google building large-scale systems.",
                "supporting_snippets": ["Built backend systems."],
            }
        ],
        base_resume_content="## Summary\nBuilt backend systems.\n",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page"},
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "unsupported_claim" in error_types
