from __future__ import annotations

import pytest

from app.services.resume_parser import ResumeParserService


class FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": "## Summary\nBuilt backend systems.\n",
                    }
                }
            ]
        }


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
    assert cleaned.startswith("Alex Example\nalex@example.com | https://linkedin.com/in/alex")
    assert "## Summary\nBuilt backend systems." in cleaned


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
                            "content": self._content,
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
    assert "- Demo: https://github.com/acme/tool" in cleaned
