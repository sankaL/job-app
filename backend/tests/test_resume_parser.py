from __future__ import annotations

import json
import time

import pytest

from app.services.resume_parser import (
    PdfParseTimeoutError,
    ResumeParserService,
    _validate_cleanup_payload,
    parse_pdf_with_timeout,
)


def _slow_pdf_process(_file_bytes, _result_queue) -> None:
    time.sleep(5)


class FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "cleaned_markdown": "## Summary\nBuilt backend systems.\n",
                                "needs_review": False,
                                "review_reason": None,
                            }
                        ),
                    }
                }
            ]
        }


def test_pdf_parser_subprocess_is_terminated_at_deadline():
    with pytest.raises(PdfParseTimeoutError, match="time limit"):
        parse_pdf_with_timeout(
            b"%PDF-1.7",
            timeout_seconds=0.05,
            _process_target=_slow_pdf_process,
        )


@pytest.mark.asyncio
async def test_cleanup_with_llm_sanitizes_prompt_and_reattaches_header(monkeypatch):
    captured_user_content: list[str] = []

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url: str, *, headers, json):
            del headers
            captured_user_content.append(json["messages"][1]["content"])
            return FakeResponse()

    monkeypatch.setattr("app.services.resume_parser.httpx.AsyncClient", FakeAsyncClient)

    service = ResumeParserService(openrouter_api_key="test-key", openrouter_model="model")
    cleaned = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n## Summary\nBuilt backend systems.\n"
    )

    assert captured_user_content == ["## Summary\nBuilt backend systems.\n"]
    assert cleaned.cleaned_markdown.startswith("Alex Example\nalex@example.com | https://linkedin.com/in/alex")
    assert "## Summary\nBuilt backend systems." in cleaned.cleaned_markdown
    assert cleaned.needs_review is False


@pytest.mark.asyncio
async def test_cleanup_with_llm_preserves_non_header_github_project_lines(monkeypatch):
    captured_user_content: list[str] = []

    class EchoResponse:
        def __init__(self, content: str) -> None:
            self._content = content

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "cleaned_markdown": self._content,
                                    "needs_review": False,
                                    "review_reason": None,
                                }
                            ),
                        }
                    }
                ]
            }

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url: str, *, headers, json):
            del headers
            content = json["messages"][1]["content"]
            captured_user_content.append(content)
            return EchoResponse(content)

    monkeypatch.setattr("app.services.resume_parser.httpx.AsyncClient", FakeAsyncClient)

    service = ResumeParserService(openrouter_api_key="test-key", openrouter_model="model")
    cleaned = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n"
        "## Projects\n- Demo: https://github.com/acme/tool\n"
    )

    assert captured_user_content == ["## Projects\n- Demo: https://github.com/acme/tool\n"]
    assert "- Demo: https://github.com/acme/tool" in cleaned.cleaned_markdown


@pytest.mark.asyncio
async def test_cleanup_with_llm_surfaces_review_warning(monkeypatch):
    class ReviewResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "cleaned_markdown": "## Experience\nAcme Corp\nBuilt APIs\n",
                                    "needs_review": True,
                                    "review_reason": "The source looked fragmented and may need manual cleanup.",
                                }
                            ),
                        }
                    }
                ]
            }

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url: str, *, headers, json):
            del headers, json
            return ReviewResponse()

    monkeypatch.setattr("app.services.resume_parser.httpx.AsyncClient", FakeAsyncClient)

    service = ResumeParserService(openrouter_api_key="test-key", openrouter_model="model")
    cleaned = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n## Experience\nAcme Corp\nBuilt APIs\n"
    )

    assert cleaned.needs_review is True
    assert cleaned.review_reason == "The source looked fragmented and may need manual cleanup."


@pytest.mark.asyncio
async def test_cleanup_with_llm_accepts_fenced_json_payload(monkeypatch):
    class ReviewResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                "```json\n"
                                '{"cleaned_markdown":"## Summary\\nBuilt backend systems.\\n","needs_review":false,"review_reason":null}\n'
                                "```"
                            ),
                        }
                    }
                ]
            }

    class FakeAsyncClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, _url: str, *, headers, json):
            del headers, json
            return ReviewResponse()

    monkeypatch.setattr("app.services.resume_parser.httpx.AsyncClient", FakeAsyncClient)

    service = ResumeParserService(openrouter_api_key="test-key", openrouter_model="model")
    cleaned = await service.cleanup_with_llm(
        "Alex Example\nalex@example.com | https://linkedin.com/in/alex\n\n## Summary\nBuilt backend systems.\n"
    )

    assert "## Summary\nBuilt backend systems." in cleaned.cleaned_markdown
    assert cleaned.needs_review is False


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {
                "cleaned_markdown": "## Summary\nBuilt backend systems.\n",
                "needs_review": False,
                "review_reason": None,
                "extra": "not allowed",
            },
            "exactly cleaned_markdown",
        ),
        (
            {
                "cleaned_markdown": "",
                "needs_review": False,
                "review_reason": None,
            },
            "non-empty string",
        ),
        (
            {
                "cleaned_markdown": "## Summary\nBuilt backend systems.\n",
                "needs_review": "false",
                "review_reason": None,
            },
            "needs_review must be a boolean",
        ),
        (
            {
                "cleaned_markdown": "## Summary\nBuilt backend systems.\n",
                "needs_review": True,
                "review_reason": None,
            },
            "review_reason is required",
        ),
    ],
)
def test_validate_cleanup_payload_rejects_malformed_contracts(payload, message):
    with pytest.raises(ValueError, match=message):
        _validate_cleanup_payload(payload)
