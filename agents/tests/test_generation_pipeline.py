from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Callable

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import generation
from experience_contract import extract_professional_experience_anchors
from privacy import sanitize_resume_markdown
from validation import validate_resume


def _reasoning_payload(effort: str) -> dict[str, dict[str, str]]:
    return {"reasoning": {"effort": effort, "exclude": True}}


class FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


def summary_section(paragraph: str = "Built backend systems.") -> dict[str, Any]:
    return {
        "id": "summary",
        "heading": "Summary",
        "content": {"paragraph": paragraph},
        "supporting_snippets": ["Built backend systems.", "APIs"],
    }


def skills_section(items: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": "skills",
        "heading": "Skills",
        "content": {"categories": [{"name": "Skills", "items": items or ["Python", "FastAPI"]}]},
        "supporting_snippets": items or ["Python", "FastAPI"],
    }


def projects_section() -> dict[str, Any]:
    return {
        "id": "projects",
        "heading": "Projects",
        "content": {
            "projects": [
                {
                    "name": "Deployment Dashboard",
                    "context": None,
                    "date_range": None,
                    "bullets": ["Built a deployment dashboard for backend services."],
                }
            ]
        },
        "supporting_snippets": ["Deployment Dashboard"],
    }


def certifications_section() -> dict[str, Any]:
    return {
        "id": "certifications",
        "heading": "Certifications",
        "content": {
            "certifications": [
                {
                    "name": "AWS Certified Developer",
                    "issuer": "Amazon Web Services",
                    "date": "2024",
                }
            ]
        },
        "supporting_snippets": ["AWS Certified Developer"],
    }


def build_fake_chat(
    callback: Callable[[dict[str, Any], Any, bool, Any], Any],
    calls: list[dict[str, Any]],
):
    class FakeStructuredLLM:
        def __init__(self, kwargs: dict[str, Any], response_model: Any) -> None:
            self.kwargs = kwargs
            self.response_model = response_model

        async def ainvoke(self, prompt, config=None):
            self.kwargs["run_config"] = config
            return callback(self.kwargs, prompt, True, self.response_model)

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs
            calls.append(kwargs)

        def with_structured_output(self, response_model):
            return FakeStructuredLLM(self.kwargs, response_model)

        async def ainvoke(self, prompt, config=None):
            self.kwargs["run_config"] = config
            return callback(self.kwargs, prompt, False, None)

    return FakeChatOpenAI


def test_reasoning_config_defaults_by_operation():
    assert generation._reasoning_config_for_operation("generation", "auto") == {"exclude": True}
    assert generation._reasoning_config_for_operation("generation", "none") == {"effort": "none"}
    assert generation._reasoning_config_for_operation("regeneration_full", "none") == {"effort": "none"}
    assert generation._reasoning_config_for_operation("keyword_optimization", "low") == {
        "effort": "low",
        "exclude": True,
    }
    assert generation._reasoning_config_for_operation("generation", "medium", is_fallback=True) == {
        "effort": "medium",
        "exclude": True,
    }
    assert generation._reasoning_config_for_operation("regeneration_section", "xhigh") == {
        "effort": "xhigh",
        "exclude": True,
    }
    assert generation._normalize_reasoning_effort(None) == "auto"
    assert generation._normalize_reasoning_effort("default") == "auto"


def test_reasoning_config_rejects_unknown_effort():
    with pytest.raises(ValueError, match="Unsupported reasoning effort"):
        generation._reasoning_config_for_operation("generation", "turbo")


def test_reasoning_error_detection_includes_mandatory_reasoning_rejections():
    assert generation._looks_like_reasoning_error(
        RuntimeError("Reasoning is mandatory for this endpoint and cannot be disabled.")
    )


def test_generation_prompt_includes_keyword_coverage_contract():
    prompt = generation._build_generation_prompt(
        operation="generation",
        base_resume_content="## Summary\nBuilt backend APIs.",
        job_title="Platform Engineer",
        company_name="Acme",
        job_description="Build React Native apps and CI/CD pipelines.",
        enabled_sections=["summary"],
        aggressiveness="high",
        target_length="1_page",
        additional_instructions=None,
        generation_settings={
            "job_keywords": ["React Native", "CI/CD"],
            "keyword_coverage_target": 80,
        },
        professional_experience_anchors=[],
    )

    human_payload = json.loads(prompt[1][1])
    assert human_payload["keyword_coverage_contract"]["keywords"] == ["React Native", "CI/CD"]
    assert human_payload["keyword_coverage_contract"]["target_percentage"] == 80
    assert human_payload["keyword_coverage_contract"]["enforcement"] == "warn_only"
    assert "case-insensitive exact phrase" in human_payload["keyword_coverage_contract"]["matching_policy"]


def test_keyword_optimization_prompt_includes_current_draft_and_minimal_edit_contract():
    prompt = generation._build_generation_prompt(
        operation="keyword_optimization",
        base_resume_content="## Summary\nBuilt backend APIs and deployment tooling.",
        job_title="Platform Engineer",
        company_name="Acme",
        job_description="Build React Native apps with CI/CD and Kubernetes.",
        enabled_sections=["summary", "skills"],
        aggressiveness="medium",
        target_length="1_page",
        additional_instructions=None,
        generation_settings={
            "job_keywords": ["React Native", "CI/CD", "Kubernetes"],
            "keyword_coverage_target": 65,
            "keyword_optimization": {
                "enabled": True,
                "target_keywords": ["Kubernetes"],
                "preserve_keywords": ["React Native", "CI/CD"],
                "starting_match": {"matched_count": 2, "total_count": 3, "percentage": 66.7},
            },
            "_current_draft_snapshot_content": "## Summary\nBuilt React Native apps and CI/CD systems.",
        },
        professional_experience_anchors=[],
    )

    system_prompt = prompt[0][1]
    assert "smallest truthful changes" in system_prompt
    assert "Do not expand the draft to repair target-length underfill during keyword optimization." in system_prompt
    assert "minimum_acceptable_words" not in system_prompt
    human_payload = json.loads(prompt[1][1])
    assert "minimum_acceptable_words" not in human_payload["length_contract"]
    assert "source_limited_allowed" not in human_payload["length_contract"]
    assert human_payload["keyword_optimization_contract"]["target_keywords"] == ["Kubernetes"]
    assert human_payload["keyword_optimization_contract"]["preserve_keywords"] == ["React Native", "CI/CD"]
    assert human_payload["keyword_optimization_contract"]["starting_match"]["matched_count"] == 2
    assert "small phrase insertions" in " ".join(human_payload["keyword_optimization_contract"]["edit_policy"])
    assert human_payload["sanitized_current_draft_markdown"] == "## Summary\nBuilt React Native apps and CI/CD systems."


def test_generated_payload_rejects_markdown_section_contract():
    with pytest.raises(Exception, match="content"):
        generation.GeneratedResumePayload.model_validate(
            {
                "sections": [
                    {
                        "id": "summary",
                        "heading": "Summary",
                        "markdown": "## Summary\nBuilt backend systems.",
                        "supporting_snippets": ["Built backend systems.", "APIs"],
                    }
                ]
            }
        )


def test_normalize_resume_payload_accepts_raw_semantic_section_map():
    payload = generation._normalize_response_payload(
        payload={"summary": {"paragraph": "Built backend systems.", "supporting_snippets": ["Built backend systems."]}},
        response_model=generation.GeneratedResumePayload,
        expected_section_ids=["summary"],
    )

    parsed = generation.GeneratedResumePayload.model_validate(payload)

    assert parsed.sections[0].id == "summary"
    assert parsed.sections[0].content == {"paragraph": "Built backend systems."}


def test_detect_source_sections_supports_compound_heading_aliases():
    detected = generation.detect_source_sections(
        "## Technical Skills & Proficiencies\nPython, FastAPI\n\n"
        "## Certificates & Licenses\nAWS Certified Developer\n"
    )

    assert "skills" in detected
    assert "certifications" in detected


def test_render_semantic_section_renders_all_supported_sections_deterministically():
    source = (
        "## Professional Experience\n"
        "Acme Corp | Remote\n"
        "Backend Engineer | 2022 - Present\n"
        "- Built APIs.\n"
    )
    anchors = extract_professional_experience_anchors(source)
    cases = [
        (
            summary_section("Built backend systems for API platforms."),
            "## Summary\nBuilt backend systems for API platforms.",
        ),
        (
            {
                "id": "professional_experience",
                "heading": "Professional Experience",
                "content": {
                    "jobs": [
                        {
                            "source_role_index": 0,
                            "company": "Acme Corp",
                            "location": "Remote",
                            "title": "Platform Engineer",
                            "date_range": "2022 - Present",
                            "bullets": ["Built APIs for internal platforms."],
                        }
                    ]
                },
                "supporting_snippets": ["Built APIs.", "Acme Corp"],
            },
            "## Professional Experience\nAcme Corp | Remote\nPlatform Engineer | 2022 - Present\n- Built APIs for internal platforms.",
        ),
        (
            {
                "id": "education",
                "heading": "Education",
                "content": {
                    "entries": [
                        {
                            "school": "State University",
                            "location": "Toronto, ON",
                            "degree_or_program": "BSc Computer Science",
                            "graduation_date": "2021",
                            "bullets": ["Graduated with honors."],
                        }
                    ]
                },
                "supporting_snippets": ["State University"],
            },
            "## Education\nState University | Toronto, ON\nBSc Computer Science | 2021\n- Graduated with honors.",
        ),
        (
            skills_section(["Python", "FastAPI"]),
            "## Skills\n- Skills: Python, FastAPI",
        ),
        (
            projects_section(),
            "## Projects\nDeployment Dashboard\n- Built a deployment dashboard for backend services.",
        ),
        (
            certifications_section(),
            "## Certifications\n- AWS Certified Developer | Amazon Web Services | 2024",
        ),
    ]

    for section_payload, expected_markdown in cases:
        rendered = generation.render_semantic_section(
            generation.GeneratedSectionPayload.model_validate(section_payload),
            professional_experience_anchors=anchors,
            aggressiveness="medium",
        )
        assert rendered["content"] == expected_markdown
        assert rendered["semantic_content"] == section_payload["content"]


def test_render_semantic_professional_experience_applies_title_rules_by_aggressiveness():
    source = (
        "## Professional Experience\n"
        "Acme Corp | Remote\n"
        "Backend Engineer | 2022 - Present\n"
        "- Built APIs.\n"
    )
    anchors = extract_professional_experience_anchors(source)
    section_payload = {
        "id": "professional_experience",
        "heading": "Professional Experience",
        "content": {
            "jobs": [
                {
                    "source_role_index": 0,
                    "company": "OtherCo",
                    "location": "Onsite",
                    "title": "Platform Engineer",
                    "date_range": "2020 - 2021",
                    "bullets": ["Built APIs for internal platforms."],
                }
            ]
        },
        "supporting_snippets": ["Built APIs.", "Acme Corp"],
    }
    section = generation.GeneratedSectionPayload.model_validate(section_payload)

    low_rendered = generation.render_semantic_section(
        section,
        professional_experience_anchors=anchors,
        aggressiveness="low",
    )
    high_rendered = generation.render_semantic_section(
        section,
        professional_experience_anchors=anchors,
        aggressiveness="high",
    )

    assert low_rendered["content"] == (
        "## Professional Experience\n"
        "Acme Corp | Remote\n"
        "Backend Engineer | 2022 - Present\n"
        "- Built APIs for internal platforms."
    )
    assert high_rendered["content"] == (
        "## Professional Experience\n"
        "Acme Corp | Remote\n"
        "Platform Engineer | 2022 - Present\n"
        "- Built APIs for internal platforms."
    )


@pytest.mark.asyncio
async def test_generate_sections_uses_structured_output_sanitized_prompt_and_reasoning(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, prompt, structured, response_model):
        assert kwargs["model"] == "primary-model"
        human_payload = json.loads(prompt[1][1])
        assert "alex@example.com" not in human_payload["sanitized_base_resume_markdown"]
        assert "linkedin.com/in/alex" not in human_payload["sanitized_base_resume_markdown"]
        assert "expert_resume_writer" in human_payload["style_contract"]
        assert "other_sections_context" not in human_payload
        assert kwargs["extra_body"] == _reasoning_payload("medium")
        assert kwargs["run_config"]["metadata"]["section_ids"] == ["summary", "skills"]
        assert kwargs["run_config"]["metadata"]["target_length"] == "1_page"
        assert kwargs["run_config"]["metadata"]["aggressiveness"] == "medium"
        assert kwargs["run_config"]["metadata"]["is_fallback"] is False
        assert structured is True
        return response_model.model_validate(
            {
                "sections": [
                    summary_section(),
                    skills_section(),
                ]
            }
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

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
        reasoning_effort="medium",
    )

    assert len(calls) == 1
    assert result["model_used"] == "primary-model"
    assert [section["name"] for section in result["sections"]] == ["summary", "skills"]


@pytest.mark.asyncio
async def test_generate_sections_uses_enabled_source_supported_intersection(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, prompt, structured, response_model):
        human_payload = json.loads(prompt[1][1])
        assert human_payload["enabled_sections"] == ["summary", "projects"]
        assert structured is True
        return response_model.model_validate({"sections": [summary_section(), projects_section()]})

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content=(
            "## Summary\nBuilt backend systems.\n\n"
            "## Projects\nDeployment Dashboard\n- Built a deployment dashboard for backend services.\n"
        ),
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[
            {"name": "summary", "enabled": True, "order": 0},
            {"name": "skills", "enabled": True, "order": 1},
            {"name": "projects", "enabled": True, "order": 2},
        ],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert [section["name"] for section in result["sections"]] == ["summary", "projects"]


@pytest.mark.asyncio
async def test_generate_sections_fails_closed_when_no_enabled_source_supported_sections_remain(monkeypatch):
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(lambda *args: None, calls))

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    with pytest.raises(ValueError, match="No enabled source-supported sections"):
        await generation.generate_sections(
            base_resume_content="## Hobbies\nWoodworking\n",
            job_title="Backend Engineer",
            company_name="Acme",
            job_description="Build APIs.",
            section_preferences=[{"name": "skills", "enabled": True, "order": 0}],
            generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
            model="primary-model",
            fallback_model="fallback-model",
            api_key="test-key",
            base_url="https://example.com",
            on_progress=on_progress,
        )

    assert calls == []


@pytest.mark.asyncio
async def test_generate_sections_uses_medium_reasoning_for_full_regeneration(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, _prompt, structured, response_model):
        assert kwargs["model"] == "primary-model"
        assert kwargs["extra_body"] == _reasoning_payload("medium")
        assert structured is True
        return response_model.model_validate(
            {
                "sections": [
                    summary_section("Reframed for target role fit.")
                ]
            }
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    result = await generation.generate_sections(
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "high", "_operation": "regeneration_full"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
        reasoning_effort="medium",
    )

    assert len(calls) == 1
    assert result["model_used"] == "primary-model"


@pytest.mark.asyncio
async def test_generate_sections_uses_fallback_model_json_when_primary_structured_output_fails(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, _prompt, structured, response_model):
        if structured:
            raise RuntimeError("structured output unsupported")
        assert kwargs["model"] == "fallback-model"
        assert kwargs["extra_body"] == _reasoning_payload("medium")
        assert kwargs["run_config"]["metadata"]["is_fallback"] is True
        return FakeResponse(
            json.dumps(
                {
                    "sections": [
                        summary_section()
                    ]
                }
            )
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

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
        reasoning_effort="medium",
    )

    assert result["model_used"] == "fallback-model"
    assert [call["model"] for call in calls] == ["primary-model", "fallback-model"]


@pytest.mark.asyncio
async def test_generate_sections_falls_back_only_after_invalid_primary_response(monkeypatch):
    calls: list[dict[str, Any]] = []
    prompt_json_calls: list[str] = []

    def callback(kwargs, _prompt, structured, response_model):
        model = kwargs["model"]
        if structured:
            assert model == "primary-model"
            return {"unexpected": "shape"}
        prompt_json_calls.append(model)
        if model == "fallback-model":
            assert kwargs["extra_body"] == _reasoning_payload("medium")
            return FakeResponse(
                json.dumps(
                    {
                    "sections": [
                        summary_section()
                    ]
                    }
                )
            )
        raise AssertionError(f"Unexpected prompt-json attempt on {model}")

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

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
        reasoning_effort="medium",
    )

    assert prompt_json_calls == ["fallback-model"]
    assert result["model_used"] == "fallback-model"


@pytest.mark.asyncio
async def test_generate_sections_uses_configured_reasoning_for_generation(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, _prompt, structured, response_model):
        assert kwargs["extra_body"] == _reasoning_payload("medium")
        assert structured is True
        return response_model.model_validate(
            {
                "sections": [
                    summary_section()
                ]
            }
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

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
        reasoning_effort="medium",
    )

    assert result["model_used"] == "primary-model"
    assert [call["extra_body"] for call in calls] == [_reasoning_payload("medium")]


@pytest.mark.asyncio
async def test_generate_sections_explicitly_disables_reasoning_when_effort_is_none(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, _prompt, structured, response_model):
        assert kwargs["extra_body"] == {"reasoning": {"effort": "none"}}
        assert structured is True
        return response_model.model_validate(
            {
                "sections": [
                    summary_section()
                ]
            }
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

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
        reasoning_effort="none",
    )

    assert result["model_used"] == "primary-model"
    assert [call["extra_body"] for call in calls] == [{"reasoning": {"effort": "none"}}]


@pytest.mark.asyncio
async def test_attempt_transport_retries_same_model_without_reasoning_when_provider_requires_it(monkeypatch):
    calls: list[Optional[dict[str, Any]]] = []

    async def fake_invoke_structured_output(**kwargs):
        calls.append(kwargs["reasoning_config"])
        if kwargs["reasoning_config"] == {"effort": "none"}:
            raise RuntimeError("Reasoning is mandatory for this endpoint and cannot be disabled.")
        return kwargs["response_model"].model_validate(
            {
                "sections": [
                    summary_section()
                ]
            }
        )

    monkeypatch.setattr(generation, "_invoke_structured_output", fake_invoke_structured_output)

    attempts: list[dict[str, Any]] = []
    payload = await generation._attempt_transport(
        prompt=[("system", "test"), ("human", "{}")],
        response_model=generation.GeneratedResumePayload,
        expected_section_ids=["summary"],
        operation="generation",
        model_name="primary-model",
        api_key="test-key",
        base_url="https://example.com",
        timeout=12.0,
        reasoning_config={"effort": "none"},
        transport_mode="structured",
        attempts=attempts,
        aggressiveness="medium",
    )

    assert payload.sections[0].id == "summary"
    assert calls == [{"effort": "none"}, None]
    assert attempts[0]["outcome"] == "reasoning_rejected"
    assert attempts[0]["retry_reason"] == "reasoning_unsupported"
    assert attempts[1]["outcome"] == "success"
    assert attempts[1]["retry_reason"] == "reasoning_unsupported"


@pytest.mark.asyncio
async def test_regenerate_single_section_includes_other_sections_context(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, prompt, structured, response_model):
        human_payload = json.loads(prompt[1][1])
        assert structured is True
        assert kwargs["extra_body"] == _reasoning_payload("medium")
        assert human_payload["other_sections_context"]
        assert human_payload["other_sections_context"][0]["id"] == "skills"
        return response_model.model_validate(
            {
                "section": summary_section("Built backend systems for high-scale APIs.")
            }
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

    result = await generation.regenerate_single_section(
        current_draft_content="## Summary\n- Built backend systems.\n\n## Skills\n- Python\n- FastAPI\n",
        section_name="summary",
        instructions="Focus more on API scale.",
        base_resume_content="## Summary\nBuilt backend systems\n\n## Skills\nPython\nFastAPI\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        reasoning_effort="medium",
    )

    assert len(calls) == 1
    assert result["name"] == "summary"
    assert result["content"].startswith("## Summary")


@pytest.mark.asyncio
async def test_regenerate_single_section_rejects_section_absent_from_source(monkeypatch):
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(lambda *args: None, calls))

    with pytest.raises(ValueError, match="Section is not supported by the source resume: skills"):
        await generation.regenerate_single_section(
            current_draft_content="## Summary\nBuilt backend systems.\n",
            section_name="skills",
            instructions="Refresh skills.",
            base_resume_content="## Summary\nBuilt backend systems.\n",
            job_title="Backend Engineer",
            company_name="Acme",
            job_description="Build APIs.",
            generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
            model="primary-model",
            fallback_model="fallback-model",
            api_key="test-key",
            base_url="https://example.com",
        )

    assert calls == []


@pytest.mark.asyncio
async def test_generate_sections_caps_supporting_snippets_by_section(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, _prompt, structured, response_model):
        assert structured is True
        return response_model.model_validate(
            {
                "sections": [
                    {
                        "id": "summary",
                        "heading": "Summary",
                        "content": {"paragraph": "Built backend systems."},
                        "supporting_snippets": [f"snippet {index}" for index in range(6)],
                    }
                ]
            }
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

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

    assert len(result["sections"][0]["supporting_snippets"]) == 4


@pytest.mark.asyncio
async def test_generate_sections_emits_progress_heartbeat_while_waiting_for_model(monkeypatch):
    progress_updates: list[tuple[int, str]] = []

    async def fake_call_json_with_fallback(**_kwargs):
        await asyncio.sleep(0.03)
        return (
            generation.GeneratedResumePayload.model_validate(
                {
                    "sections": [
                        summary_section()
                    ]
                }
            ),
            "primary-model",
            [{"model": "primary-model", "transport_mode": "structured", "outcome": "success", "elapsed_ms": 30}],
        )

    monkeypatch.setattr(generation, "_call_json_with_fallback", fake_call_json_with_fallback)
    monkeypatch.setattr(generation, "GENERATION_HEARTBEAT_INTERVAL_SECONDS", 0.01)

    async def on_progress(percent: int, message: str) -> None:
        progress_updates.append((percent, message))

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

    assert result["model_used"] == "primary-model"
    assert progress_updates[0] == (20, "Preparing generation plan for Summary")
    assert progress_updates[1] == (35, "Generating Summary with structured output")
    assert any(
        percent == generation.GENERATION_HEARTBEAT_PERCENT and message.startswith("Generating sections:")
        for percent, message in progress_updates
    )
    assert (60, "Normalizing structured section output") in progress_updates
    assert progress_updates[-1] == (70, "Parsing structured resume output")


@pytest.mark.asyncio
async def test_generate_sections_uses_full_draft_timeout(monkeypatch):
    observed_timeouts: list[float] = []

    async def fake_call_json_with_fallback(**kwargs):
        observed_timeouts.append(kwargs["timeout"])
        return (
            generation.GeneratedResumePayload.model_validate(
                {
                    "sections": [
                        summary_section()
                    ]
                }
            ),
            "primary-model",
            [{"model": "primary-model", "transport_mode": "structured", "outcome": "success", "elapsed_ms": 1}],
        )

    monkeypatch.setattr(generation, "_call_json_with_fallback", fake_call_json_with_fallback)

    async def on_progress(_percent: int, _message: str) -> None:
        return None

    await generation.generate_sections(
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium", "_operation": "regeneration_full"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
        on_progress=on_progress,
    )

    assert observed_timeouts == [generation.FULL_DRAFT_LLM_TIMEOUT_SECONDS]


@pytest.mark.asyncio
async def test_regenerate_single_section_uses_section_timeout(monkeypatch):
    observed_timeouts: list[float] = []

    async def fake_call_json_with_fallback(**kwargs):
        observed_timeouts.append(kwargs["timeout"])
        return (
            generation.RegeneratedSectionPayload.model_validate(
                {
                    "section": summary_section("Built backend systems for APIs.")
                }
            ),
            "primary-model",
            [{"model": "primary-model", "transport_mode": "structured", "outcome": "success", "elapsed_ms": 1}],
        )

    monkeypatch.setattr(generation, "_call_json_with_fallback", fake_call_json_with_fallback)

    await generation.regenerate_single_section(
        current_draft_content="## Summary\n- Built backend systems.\n\n## Skills\n- Python\n- FastAPI\n",
        section_name="summary",
        instructions="Focus more on API scale.",
        base_resume_content="## Summary\nBuilt backend systems\n\n## Skills\nPython\nFastAPI\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        model="primary-model",
        fallback_model="fallback-model",
        api_key="test-key",
        base_url="https://example.com",
    )

    assert observed_timeouts == [generation.SECTION_REGENERATION_LLM_TIMEOUT_SECONDS]


@pytest.mark.asyncio
async def test_repair_generated_response_prefers_unused_fallback_model(monkeypatch):
    calls: list[dict[str, Any]] = []

    def callback(kwargs, prompt, structured, response_model):
        assert structured is False
        assert kwargs["model"] == "fallback-model"
        assert kwargs["extra_body"] is None
        repair_payload = json.loads(prompt[-1][1])
        assert repair_payload["validation_errors"] == ["Wrong section order", "Missing evidence"]
        return FakeResponse(
            json.dumps(
                {
                    "sections": [
                        summary_section()
                    ]
                }
            )
        )

    monkeypatch.setattr(generation, "ChatOpenAI", build_fake_chat(callback, calls))

    payload, repair_model, attempts, error = await generation.repair_generated_response(
        prompt=[("system", "sys"), ("human", json.dumps({"response_contract": {}}))],
        response_model=generation.GeneratedResumePayload,
        expected_section_ids=["summary"],
        operation="generation",
        validation_errors=["Wrong section order", {"detail": "Missing evidence"}],
        prior_response={
            "sections": [
                {
                    "id": "summary",
                    "heading": "Summary",
                    "content": {"paragraph": "Draft"},
                    "supporting_snippets": ["Built backend systems."],
                }
            ]
        },
        model="primary-model",
        fallback_model="fallback-model",
        model_used="primary-model",
        prior_attempts=[{"model": "primary-model", "outcome": "structured_failed"}],
        api_key="test-key",
        base_url="https://example.com",
        timeout=10,
        aggressiveness="medium",
    )

    assert error is None
    assert repair_model == "fallback-model"
    assert payload is not None
    assert payload.sections[0].id == "summary"
    assert attempts[-1]["transport_mode"] == "repair_json"


@pytest.mark.asyncio
async def test_repair_generated_response_fails_fast_when_no_timeout_budget_remains():
    payload, repair_model, attempts, error = await generation.repair_generated_response(
        prompt=[("system", "sys"), ("human", json.dumps({"response_contract": {}}))],
        response_model=generation.GeneratedResumePayload,
        expected_section_ids=["summary"],
        operation="generation",
        validation_errors=["Wrong section order"],
        prior_response={"sections": []},
        model="primary-model",
        fallback_model="fallback-model",
        model_used="primary-model",
        prior_attempts=[{"model": "primary-model", "outcome": "success"}],
        api_key="test-key",
        base_url="https://example.com",
        timeout=0,
        aggressiveness="medium",
    )

    assert payload is None
    assert repair_model == "primary-model"
    assert attempts == []
    assert isinstance(error, asyncio.TimeoutError)


def test_build_validation_repair_prompt_adds_experience_tailoring_guidance():
    prompt = generation._build_validation_repair_prompt(
        prompt=[("system", "sys"), ("human", json.dumps({"response_contract": {}}))],
        validation_errors=[
            {
                "type": "insufficient_experience_tailoring",
                "detail": "Insufficient Professional Experience tailoring for high aggressiveness.",
            }
        ],
        prior_response={"sections": []},
    )

    repair_payload = json.loads(prompt[-1][1])
    assert "materially rewrite Professional Experience" in repair_payload["repair_task"]
    assert "Do not satisfy this repair by changing only Summary or Skills." in repair_payload["repair_task"]


def test_build_validation_repair_prompt_adds_grounded_length_expansion_guidance():
    prompt = generation._build_validation_repair_prompt(
        prompt=[("system", "sys"), ("human", json.dumps({"response_contract": {}}))],
        validation_errors=[
            {
                "type": "length_underfilled",
                "detail": "Generated content is below the source-aware minimum.",
            }
        ],
        prior_response={"sections": []},
    )

    repair_payload = json.loads(prompt[-1][1])
    assert "restoring grounded source-resume material" in repair_payload["repair_task"]
    assert "Do not add padding" in repair_payload["repair_task"]


@pytest.mark.asyncio
async def test_call_json_with_fallback_preserves_timeout_error(monkeypatch):
    async def fake_invoke_structured_output(**_kwargs):
        raise asyncio.TimeoutError("primary timed out")

    async def fake_invoke_prompt_json(**_kwargs):
        raise asyncio.TimeoutError("prompt fallback timed out")

    monkeypatch.setattr(generation, "_invoke_structured_output", fake_invoke_structured_output)
    monkeypatch.setattr(generation, "_invoke_prompt_json", fake_invoke_prompt_json)

    with pytest.raises(asyncio.TimeoutError, match="timed out"):
        await generation._call_json_with_fallback(
            prompt=[("system", "test"), ("human", "{}")],
            response_model=generation.GeneratedResumePayload,
            expected_section_ids=["summary"],
            operation="generation",
            model="primary-model",
            fallback_model="fallback-model",
            api_key="test-key",
            base_url="https://example.com",
            timeout=12.0,
            aggressiveness="medium",
            reasoning_effort="medium",
        )


def test_generation_prompt_includes_expert_role_voice_rules_no_em_dash_and_length_budget():
    prompt = generation._build_generation_prompt(
        operation="generation",
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        enabled_sections=["summary", "skills"],
        aggressiveness="low",
        target_length="1_page",
        additional_instructions="Keep it concise.",
        professional_experience_anchors=[],
    )

    system_prompt = prompt[0][1]
    human_payload = json.loads(prompt[1][1])
    assert "expert ATS resume writer and editor" in system_prompt
    assert "Do not use first-person narration or em dashes" in system_prompt
    assert 'Avoid resume filler such as "proven ability to"' in system_prompt
    assert "even when those phrases appear in the source" in system_prompt
    assert "Do not change skills content or grouping." in system_prompt
    assert "Preferred total length when it fits the source naturally: 450-700 words." in system_prompt
    assert "minimum_acceptable_words" in system_prompt
    assert "Do not prune or regroup skills to satisfy length guidance in low-aggressiveness mode." in system_prompt
    assert human_payload["length_contract"]["source_word_count"] > 0
    assert human_payload["length_contract"]["minimum_acceptable_words"] > 0
    assert human_payload["length_contract"]["source_limited_allowed"] is True


def test_medium_generation_prompt_keeps_length_caps_and_allows_bounded_title_reframing():
    prompt = generation._build_generation_prompt(
        operation="generation",
        base_resume_content="## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        enabled_sections=["professional_experience"],
        aggressiveness="medium",
        target_length="1_page",
        additional_instructions="Keep it concise.",
        professional_experience_anchors=[
            {
                "role_index": 0,
                "source_title": "Backend Engineer",
                "source_company": "Acme",
                "source_date_range": "2022 - Present",
            }
        ],
    )

    system_prompt = prompt[0][1]
    assert "Target total length: 450-700 words." in system_prompt
    assert "cap bullets at 4 per role" in system_prompt
    assert "Bullet and skills-category caps are ceilings for focus" in system_prompt
    assert "Two source bullets covering related grounded work may be consolidated into one stronger bullet" in system_prompt
    assert "profession experience is the primary tailoring surface in medium mode".replace("profession", "professional") in system_prompt.lower()
    assert "do not spend nearly all tailoring budget on summary or skills while leaving professional experience bullets source-identical" in system_prompt.lower()
    assert "keep professional experience role order fixed to the source anchors" in system_prompt.lower()
    assert "lightly reframe the role title only when it preserves the same core role family and seniority" in system_prompt.lower()
    assert "Worked example of bounded medium title reframing" in system_prompt
    assert "Worked example of material Professional Experience tailoring inside fixed role order" in system_prompt
    assert "you may add jd-relevant non-factual keyword phrasing" in system_prompt.lower()
    assert "add jd-aligned keyword skills for fit" in system_prompt.lower()
    assert "Worked example of bounded professional inference in high aggressiveness" not in system_prompt


def test_high_generation_prompt_allows_truthful_role_title_rewrites_only_in_experience():
    prompt = generation._build_generation_prompt(
        operation="generation",
        base_resume_content="## Professional Experience\n**Backend Engineer** | Acme | 2022 - Present\n- Built backend systems.\n",
        job_title="Platform Engineer",
        company_name="Acme",
        job_description="Build platform APIs.",
        enabled_sections=["professional_experience"],
        aggressiveness="high",
        target_length="1_page",
        additional_instructions="Match the target role.",
        professional_experience_anchors=[
            {
                "role_index": 0,
                "source_title": "Backend Engineer",
                "source_company": "Acme",
                "source_date_range": "2022 - Present",
            }
        ],
    )

    system_prompt = prompt[0][1]
    assert "you may make bounded professional inferences from demonstrated patterns in the source" in system_prompt.lower()
    assert "you may introduce jd-driven non-factual keywords for fit" in system_prompt.lower()
    assert "you should actively retitle the role name for alignment or adjacent role framing" in system_prompt.lower()
    assert "materially rewrite bullet framing in the first up to 2 source-ordered roles that have bullets" in system_prompt.lower()
    assert "keep company and dates unchanged" in system_prompt.lower()
    assert "Worked example of bounded medium title reframing" in system_prompt
    assert "Worked example of material Professional Experience tailoring inside fixed role order" in system_prompt
    assert "Worked example of bounded professional inference in high aggressiveness" in system_prompt
    assert 'Acceptable high-aggressiveness inference: retitle the role as "QA Engineering Lead"' in system_prompt
    assert "do not default to the source title when grounded target alignment is clear" in system_prompt.lower()

    human_payload = json.loads(prompt[1][1])
    title_policy = human_payload["professional_experience_structure_contract"]["title_rewrite_policy"]
    assert title_policy["mode"] == "active_grounded_retitle"
    assert "jobs[].title" in title_policy["jobs_title_instruction"]
    assert "Do not default to the source title when grounded target alignment is clear" in title_policy["jobs_title_instruction"]

    section_prompt = generation._build_section_regeneration_prompt(
        section_name="professional_experience",
        instructions="Target the platform role.",
        current_section_content="## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.",
        other_sections_context=[],
        base_resume_content="## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n",
        job_title="Platform Engineer",
        company_name="Acme",
        job_description="Build platform APIs.",
        aggressiveness="high",
        target_length="1_page",
        professional_experience_anchors=[
            {
                "role_index": 0,
                "source_title": "Backend Engineer",
                "source_company": "Acme",
                "source_date_range": "2022 - Present",
            }
        ],
    )
    section_system_prompt = section_prompt[0][1]
    assert "Treat the selected full-draft length as proportion and tone context for this section only." in section_system_prompt
    assert "Do not expand this section solely to repair whole-resume underfill." in section_system_prompt
    assert "minimum_acceptable_words" not in section_system_prompt
    section_human_payload = json.loads(section_prompt[1][1])
    assert "minimum_acceptable_words" not in section_human_payload["length_contract"]
    assert "source_limited_allowed" not in section_human_payload["length_contract"]
    assert (
        section_human_payload["professional_experience_structure_contract"]["title_rewrite_policy"]["mode"]
        == "active_grounded_retitle"
    )


def test_low_generation_prompt_does_not_include_high_inference_example():
    prompt = generation._build_generation_prompt(
        operation="generation",
        base_resume_content="## Summary\nBuilt backend systems.\n",
        job_title="Backend Engineer",
        company_name="Acme",
        job_description="Build APIs.",
        enabled_sections=["summary"],
        aggressiveness="low",
        target_length="1_page",
        additional_instructions="Keep it concise.",
        professional_experience_anchors=[],
    )

    system_prompt = prompt[0][1]
    assert "Worked example of bounded professional inference in high aggressiveness" not in system_prompt


def test_response_contract_payload_uses_section_minimum_snippet_examples():
    payload = generation._response_contract_payload(["summary", "education"])

    assert len(payload[0]["supporting_snippets"]) == 2
    assert len(payload[1]["supporting_snippets"]) == 1


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
async def test_validate_resume_rejects_contact_leakage_unsupported_dates_and_em_dashes():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nReach me at alex@example.com — worked from Jan 2024 to Present.",
                "supporting_snippets": ["Built backend systems.", "APIs"],
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
    assert "style_violation" in error_types


@pytest.mark.asyncio
async def test_validate_resume_rejects_malformed_professional_experience_when_anchors_are_unavailable():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": (
                    "## Professional Experience\n"
                    "Acme Corp\n"
                    "Remote\n"
                    "Backend Engineer | 2021 - Present\n"
                    "- Built backend systems.\n"
                ),
                "supporting_snippets": ["Built backend systems.", "Built backend systems."],
            }
        ],
        base_resume_content=(
            "## Professional Experience\n"
            "Acme Corp\n"
            "Remote\n"
            "Backend Engineer | 2021 - Present\n"
            "- Built backend systems.\n"
        ),
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        professional_experience_anchors=[],
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "experience_structure_violation" in error_types
    assert result["valid"] is False


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
                ],
            }
        ],
        base_resume_content=(
            "## Skills\n"
            "- Programming Languages: Python, JavaScript, TypeScript, Java, SQL\n"
            "- Tools & Technologies: Jenkins\n"
            "- Management Tools: Azure DevOps, BitBucket\n"
            "- Methodologies & Standards: Agile, CI/CD\n"
        ),
        section_preferences=[{"name": "skills", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page"},
        length_validation_mode="section",
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "unsupported_snippet" not in error_types
    assert result["valid"] is True


@pytest.mark.asyncio
async def test_validate_resume_rejects_unsupported_role_and_company_claims():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nStaff Engineer at Google building large-scale systems.",
                "supporting_snippets": ["Built backend systems.", "APIs"],
            }
        ],
        base_resume_content="## Summary\nBuilt backend systems.\n",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page"},
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "unsupported_claim" in error_types


@pytest.mark.asyncio
async def test_validate_resume_allows_high_aggressiveness_experience_role_title_rewrite():
    anchors = extract_professional_experience_anchors(
        "## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n- Maintained deployment tooling.\n"
    )
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": "## Professional Experience\nPlatform Engineer | Acme | 2022 - Present\n- Built backend systems and maintained deployment tooling.",
                "supporting_snippets": ["Built backend systems.", "Maintained deployment tooling."],
            }
        ],
        base_resume_content=(
            "## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n"
            "- Built backend systems.\n- Maintained deployment tooling.\n"
        ),
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "high"},
        professional_experience_anchors=anchors,
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "unsupported_claim" not in error_types
    assert result["valid"] is True


@pytest.mark.asyncio
async def test_validate_resume_rejects_high_aggressiveness_management_title_without_source_scope():
    anchors = extract_professional_experience_anchors(
        "## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n"
    )
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": "## Professional Experience\nEngineering Manager | Acme | 2022 - Present\n- Built backend systems.",
                "supporting_snippets": ["Built backend systems.", "Acme"],
            }
        ],
        base_resume_content="## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n",
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "high"},
        professional_experience_anchors=anchors,
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "experience_structure_violation" in error_types
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_validate_resume_rejects_semantic_professional_experience_anchor_mismatch():
    source = (
        "## Professional Experience\n"
        "Backend Engineer | Acme | 2022 - Present\n"
        "- Built backend systems.\n"
    )
    anchors = extract_professional_experience_anchors(source)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": (
                    "## Professional Experience\n"
                    "Backend Engineer | OtherCo | 2020 - 2021\n"
                    "- Built backend systems.\n"
                ),
                "semantic_content": {
                    "jobs": [
                        {
                            "source_role_index": 0,
                            "company": "OtherCo",
                            "location": None,
                            "title": "Backend Engineer",
                            "date_range": "2020 - 2021",
                            "bullets": ["Built backend systems."],
                        }
                    ]
                },
                "supporting_snippets": ["Built backend systems.", "Acme"],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        professional_experience_anchors=anchors,
    )

    semantic_errors = [
        error["detail"]
        for error in result["errors"]
        if error["type"] == "semantic_contract_violation"
    ]
    assert any("company must match source company" in detail for detail in semantic_errors)
    assert any("date_range must match source date range" in detail for detail in semantic_errors)
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_validate_resume_allows_grounded_medium_aggressiveness_experience_role_title_rewrite():
    anchors = extract_professional_experience_anchors(
        "## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n"
    )
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": "## Professional Experience\nPlatform Engineer | Acme | 2022 - Present\n- Built backend systems.",
                "supporting_snippets": ["Built backend systems.", "Acme"],
            }
        ],
        base_resume_content="## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n",
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        professional_experience_anchors=anchors,
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "unsupported_claim" not in error_types
    assert result["valid"] is True


@pytest.mark.asyncio
async def test_validate_resume_rejects_medium_when_professional_experience_stays_identical():
    source = (
        "## Professional Experience\n"
        "Backend Engineer | Acme | 2022 - Present\n"
        "- Built backend systems.\n"
    )
    anchors = extract_professional_experience_anchors(source)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": source.strip(),
                "supporting_snippets": ["Built backend systems.", "Acme"],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        professional_experience_anchors=anchors,
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "insufficient_experience_tailoring" in error_types
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_validate_resume_rejects_high_when_only_summary_and_skills_change():
    base_resume = (
        "## Summary\nBuilt backend systems.\n\n"
        "## Professional Experience\n"
        "Backend Engineer | Acme | 2022 - Present\n"
        "- Built backend systems.\n"
        "- Maintained deployment tooling.\n\n"
        "## Skills\n- Python\n- FastAPI\n"
    )
    anchors = extract_professional_experience_anchors(base_resume)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nBuilt backend systems for platform reliability work.",
                "supporting_snippets": ["Built backend systems.", "Built backend systems."],
            },
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": (
                    "## Professional Experience\n"
                    "Backend Engineer | Acme | 2022 - Present\n"
                    "- Built backend systems.\n"
                    "- Maintained deployment tooling."
                ),
                "supporting_snippets": ["Built backend systems.", "Maintained deployment tooling."],
            },
            {
                "name": "skills",
                "heading": "Skills",
                "content": "## Skills\n- Python\n- FastAPI\n- Kubernetes",
                "supporting_snippets": ["Python", "FastAPI"],
            },
        ],
        base_resume_content=base_resume,
        section_preferences=[
            {"name": "summary", "enabled": True, "order": 0},
            {"name": "professional_experience", "enabled": True, "order": 1},
            {"name": "skills", "enabled": True, "order": 2},
        ],
        generation_settings={"page_length": "1_page", "aggressiveness": "high"},
        professional_experience_anchors=anchors,
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "insufficient_experience_tailoring" in error_types
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_validate_resume_allows_high_with_one_rewritten_bullet_when_only_one_source_bullet_exists():
    source = (
        "## Professional Experience\n"
        "Backend Engineer | Acme | 2022 - Present\n"
        "- Built backend systems.\n"
    )
    anchors = extract_professional_experience_anchors(source)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": (
                    "## Professional Experience\n"
                    "Backend Engineer | Acme | 2022 - Present\n"
                    "- Built backend systems for internal platform reliability work.\n"
                ),
                "supporting_snippets": ["Built backend systems.", "Acme"],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "high"},
        professional_experience_anchors=anchors,
    )

    assert result["valid"] is True


@pytest.mark.asyncio
async def test_validate_resume_rejects_ungrounded_medium_aggressiveness_experience_role_title_rewrite():
    anchors = extract_professional_experience_anchors(
        "## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n"
    )
    result = await validate_resume(
        generated_sections=[
            {
                "name": "professional_experience",
                "heading": "Professional Experience",
                "content": "## Professional Experience\nEngagement Lead | Acme | 2022 - Present\n- Built backend systems.",
                "supporting_snippets": ["Built backend systems.", "Acme"],
            }
        ],
        base_resume_content="## Professional Experience\nBackend Engineer | Acme | 2022 - Present\n- Built backend systems.\n",
        section_preferences=[{"name": "professional_experience", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
        professional_experience_anchors=anchors,
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "experience_structure_violation" in error_types
    assert result["valid"] is False


@pytest.mark.asyncio
async def test_validate_resume_rejects_when_section_needs_more_supporting_snippets():
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": "## Summary\nBuilt backend systems.",
                "supporting_snippets": ["Built backend systems."],
            }
        ],
        base_resume_content="## Summary\nBuilt backend systems.\n",
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page"},
    )

    error_types = {error["type"] for error in result["errors"]}
    assert "missing_support" in error_types


def _repeated_summary(word_target: int) -> str:
    sentence = "Built reliable APIs for regulated financial platforms. "
    repeated = sentence * max(1, word_target // 7)
    return "## Summary\n" + repeated


@pytest.mark.asyncio
async def test_validate_resume_rejects_two_page_draft_below_source_aware_minimum():
    source = _repeated_summary(1000)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": _repeated_summary(800),
                "supporting_snippets": [
                    "Built reliable APIs for regulated financial platforms.",
                    "Built reliable APIs for regulated financial platforms.",
                ],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "2_page", "aggressiveness": "medium"},
    )

    assert result["valid"] is False
    assert {error["type"] for error in result["errors"]} == {"length_underfilled"}
    assert result["errors"][0]["metadata"]["minimum_acceptable_words"] == 900


@pytest.mark.asyncio
async def test_validate_resume_rejects_one_page_source_rich_draft_below_target_minimum():
    source = _repeated_summary(600)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": _repeated_summary(400),
                "supporting_snippets": [
                    "Built reliable APIs for regulated financial platforms.",
                    "Built reliable APIs for regulated financial platforms.",
                ],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "1_page", "aggressiveness": "medium"},
    )

    assert result["valid"] is False
    assert {error["type"] for error in result["errors"]} == {"length_underfilled"}
    assert result["errors"][0]["metadata"]["minimum_acceptable_words"] == 450


@pytest.mark.asyncio
async def test_validate_resume_allows_source_limited_two_page_draft_with_warning():
    source = _repeated_summary(800)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": _repeated_summary(735),
                "supporting_snippets": [
                    "Built reliable APIs for regulated financial platforms.",
                    "Built reliable APIs for regulated financial platforms.",
                ],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "2_page", "aggressiveness": "medium"},
    )

    assert result["valid"] is True
    assert result["warnings"][0]["type"] == "source_limited_length"
    assert result["warnings"][0]["metadata"]["source_limited_allowed"] is True
    assert (
        result["warnings"][0]["metadata"]["generated_word_count"]
        >= result["warnings"][0]["metadata"]["minimum_acceptable_words"]
    )


@pytest.mark.asyncio
async def test_validate_resume_allows_very_short_source_limited_draft():
    source = _repeated_summary(105)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": _repeated_summary(100),
                "supporting_snippets": [
                    "Built reliable APIs for regulated financial platforms.",
                    "Built reliable APIs for regulated financial platforms.",
                ],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "2_page", "aggressiveness": "medium"},
    )

    assert result["valid"] is True
    assert result["warnings"][0]["type"] == "source_limited_length"


@pytest.mark.asyncio
async def test_validate_resume_section_mode_skips_full_draft_underfill_check():
    source = _repeated_summary(1000)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": _repeated_summary(100),
                "supporting_snippets": [
                    "Built reliable APIs for regulated financial platforms.",
                    "Built reliable APIs for regulated financial platforms.",
                ],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "2_page", "aggressiveness": "medium"},
        length_validation_mode="section",
    )

    assert result["valid"] is True
    assert result["warnings"] == []


@pytest.mark.asyncio
async def test_validate_resume_still_rejects_over_hard_cap_draft():
    source = _repeated_summary(1900)
    result = await validate_resume(
        generated_sections=[
            {
                "name": "summary",
                "heading": "Summary",
                "content": _repeated_summary(1700),
                "supporting_snippets": [
                    "Built reliable APIs for regulated financial platforms.",
                    "Built reliable APIs for regulated financial platforms.",
                ],
            }
        ],
        base_resume_content=source,
        section_preferences=[{"name": "summary", "enabled": True, "order": 0}],
        generation_settings={"page_length": "2_page", "aggressiveness": "medium"},
    )

    assert result["valid"] is False
    assert {error["type"] for error in result["errors"]} == {"length_mismatch"}
