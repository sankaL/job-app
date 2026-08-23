from __future__ import annotations

import io
import json
import logging
import multiprocessing
import queue
import re
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.tracing import sanitize_trace_data, trace_llm_scope
from app.services.resume_privacy import reattach_header_lines, sanitize_resume_markdown
from app.services.unslop_prompt import build_unslop_prompt_block

logger = logging.getLogger(__name__)
MAX_PDF_PAGES = 50
MAX_EXTRACTED_CHARACTERS = 200_000
PDF_PARSE_TIMEOUT_SECONDS = 15.0


class PdfParseTimeoutError(RuntimeError):
    pass


class PdfParseRejectedError(ValueError):
    pass


class PdfParseFailedError(ValueError):
    pass


@dataclass
class ResumeCleanupResult:
    cleaned_markdown: str
    needs_review: bool = False
    review_reason: Optional[str] = None


def _parse_pdf_process(file_bytes: bytes, result_queue) -> None:
    try:
        result_queue.put(("ok", ResumeParserService().parse_pdf(file_bytes)))
    except ValueError as error:
        result_queue.put(("rejected", str(error)))
    except Exception:
        result_queue.put(("failed", None))


def parse_pdf_with_timeout(
    file_bytes: bytes,
    *,
    timeout_seconds: float = PDF_PARSE_TIMEOUT_SECONDS,
    _process_target=_parse_pdf_process,
) -> str:
    """Parse an untrusted PDF in a killable subprocess with a hard deadline."""

    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(
        target=_process_target,
        args=(file_bytes, result_queue),
        daemon=True,
    )
    process.start()
    process.join(timeout_seconds)
    try:
        if process.is_alive():
            process.terminate()
            process.join(1)
            if process.is_alive():
                process.kill()
                process.join(1)
            raise PdfParseTimeoutError("PDF parsing exceeded its time limit.")

        try:
            outcome, payload = result_queue.get(timeout=1)
        except queue.Empty as error:
            raise PdfParseFailedError("PDF parsing failed.") from error

        if outcome == "ok" and isinstance(payload, str):
            return payload
        if outcome == "rejected" and isinstance(payload, str):
            raise PdfParseRejectedError(payload)
        raise PdfParseFailedError("PDF parsing failed.")
    finally:
        result_queue.close()
        result_queue.join_thread()
        process.close()


def _extract_json_payload(text: str) -> dict:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)

    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    first_brace = stripped.find("{")
    last_brace = stripped.rfind("}")
    if first_brace == -1 or last_brace == -1 or last_brace <= first_brace:
        raise json.JSONDecodeError("No JSON object found.", stripped, 0)

    payload = json.loads(stripped[first_brace : last_brace + 1])
    if not isinstance(payload, dict):
        raise TypeError("Cleanup response payload must be an object.")
    return payload


def _validate_cleanup_payload(payload: dict) -> tuple[str, bool, Optional[str]]:
    expected_keys = {"cleaned_markdown", "needs_review", "review_reason"}
    if set(payload.keys()) != expected_keys:
        raise ValueError("Cleanup response must contain exactly cleaned_markdown, needs_review, and review_reason.")
    cleaned_markdown = payload["cleaned_markdown"]
    needs_review = payload["needs_review"]
    review_reason = payload["review_reason"]
    if not isinstance(cleaned_markdown, str) or not cleaned_markdown.strip():
        raise ValueError("cleaned_markdown must be a non-empty string.")
    if not isinstance(needs_review, bool):
        raise ValueError("needs_review must be a boolean.")
    if review_reason is not None and not isinstance(review_reason, str):
        raise ValueError("review_reason must be a string or null.")
    normalized_reason = review_reason.strip() if isinstance(review_reason, str) else None
    if needs_review and not normalized_reason:
        raise ValueError("review_reason is required when needs_review is true.")
    if not needs_review:
        normalized_reason = None
    return cleaned_markdown, needs_review, normalized_reason


class ResumeParserService:
    """Service for parsing PDF resumes and optionally cleaning them up with LLM."""

    def __init__(
        self,
        openrouter_api_key: Optional[str] = None,
        openrouter_model: str = "openai/gpt-5.6-luna",
        langsmith_tracing: bool = False,
        langsmith_project: Optional[str] = None,
        langsmith_api_key: Optional[str] = None,
    ) -> None:
        self.openrouter_api_key = openrouter_api_key
        self.openrouter_model = openrouter_model
        self.langsmith_tracing = langsmith_tracing
        self.langsmith_project = langsmith_project
        self.langsmith_api_key = langsmith_api_key
        if self.langsmith_tracing:
            if not str(self.langsmith_project or "").strip():
                raise ValueError("LANGSMITH_PROJECT is required when LANGSMITH_TRACING=true.")
            if not str(self.langsmith_api_key or "").strip():
                raise ValueError("LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.")

    def parse_pdf(self, file_bytes: bytes) -> str:
        """
        Parse a PDF file and extract text as Markdown.

        Args:
            file_bytes: Raw bytes of the PDF file

        Returns:
            Raw Markdown string extracted from the PDF
        """
        import pdfplumber

        markdown_lines: list[str] = []
        extracted_characters = 0

        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            if len(pdf.pages) > MAX_PDF_PAGES:
                raise ValueError("PDF has too many pages.")
            for page_num, page in enumerate(pdf.pages):
                text = page.extract_text()
                if not text:
                    continue
                extracted_characters += len(text)
                if extracted_characters > MAX_EXTRACTED_CHARACTERS:
                    raise ValueError("PDF contains too much text.")

                # Process the text to detect structure
                lines = text.split("\n")
                processed_lines = self._convert_to_markdown(lines)
                markdown_lines.extend(processed_lines)

                # Add page break between pages (except after last page)
                if page_num < len(pdf.pages) - 1:
                    markdown_lines.append("")

        return "\n".join(markdown_lines)

    def _convert_to_markdown(self, lines: list[str]) -> list[str]:
        """
        Convert plain text lines to Markdown format.

        Detects:
        - ALL CAPS headings
        - Bold patterns (already in text)
        - Bullet points
        - Paragraph breaks
        """
        result: list[str] = []
        prev_was_empty = True  # Start as if previous line was empty

        for line in lines:
            stripped = line.strip()
            if not stripped:
                if not prev_was_empty:
                    result.append("")
                    prev_was_empty = True
                continue

            # Check for ALL CAPS section headings (e.g., "EXPERIENCE", "EDUCATION")
            if self._is_section_heading(stripped):
                result.append("")
                result.append(f"## {stripped.title()}")
                prev_was_empty = False
                continue

            # Check for bullet points (common patterns: •, -, *, •)
            if self._is_bullet_point(stripped):
                # Normalize bullet to Markdown format
                bullet_content = self._extract_bullet_content(stripped)
                result.append(f"- {bullet_content}")
                prev_was_empty = False
                continue

            # Regular paragraph text
            result.append(stripped)
            prev_was_empty = False

        return result

    def _is_section_heading(self, line: str) -> bool:
        """Detect if a line is a section heading (ALL CAPS, short line)."""
        # Must be primarily uppercase letters and spaces
        # Common resume sections
        common_sections = {
            "EXPERIENCE",
            "WORK EXPERIENCE",
            "PROFESSIONAL EXPERIENCE",
            "EDUCATION",
            "SKILLS",
            "TECHNICAL SKILLS",
            "SUMMARY",
            "PROFESSIONAL SUMMARY",
            "OBJECTIVE",
            "CERTIFICATIONS",
            "CERTIFICATES",
            "PROJECTS",
            "AWARDS",
            "HONORS",
            "PUBLICATIONS",
            "LANGUAGES",
            "INTERESTS",
            "REFERENCES",
            "CONTACT",
            "CONTACT INFORMATION",
            "PROFILE",
            "ABOUT",
            "ABOUT ME",
        }

        upper_line = line.upper()
        # Check if it's a known section or looks like a heading
        if upper_line in common_sections:
            return True

        # Check if it's short (under 40 chars) and mostly uppercase
        if len(line) < 40:
            letters = [c for c in line if c.isalpha()]
            if letters:
                uppercase_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
                # At least 80% uppercase and not too many words
                if uppercase_ratio >= 0.8 and len(line.split()) <= 4:
                    return True

        return False

    def _is_bullet_point(self, line: str) -> bool:
        """Check if a line starts with a bullet point indicator."""
        bullet_patterns = [
            r"^[•●○◆◇▪▫]\s*",  # Unicode bullets
            r"^[-*+]\s+",  # Markdown-style bullets (must have space after)
            r"^\d+[.)]\s+",  # Numbered lists
        ]
        for pattern in bullet_patterns:
            if re.match(pattern, line):
                return True
        return False

    def _extract_bullet_content(self, line: str) -> str:
        """Extract the content of a bullet point, removing the bullet marker."""
        # Remove various bullet markers
        patterns = [
            (r"^[•●○◆◇▪▫]\s*", ""),  # Unicode bullets
            (r"^[-*+]\s+", ""),  # Markdown-style bullets
            (r"^\d+[.)]\s+", ""),  # Numbered lists
        ]
        result = line
        for pattern, replacement in patterns:
            result = re.sub(pattern, replacement, result)
        return result.strip()

    async def cleanup_with_llm(self, raw_markdown: str) -> ResumeCleanupResult:
        """
        Clean up the parsed resume using LLM.

        If no API key is configured, returns the raw_markdown unchanged.
        On any failure (timeout, API error), logs warning and returns raw_markdown.

        Args:
            raw_markdown: The raw Markdown extracted from PDF

        Returns:
            Cleaned up Markdown, or original if cleanup fails
        """
        if not self.openrouter_api_key:
            logger.debug("OpenRouter API key not configured, skipping LLM cleanup")
            return ResumeCleanupResult(cleaned_markdown=raw_markdown)

        sanitized = sanitize_resume_markdown(raw_markdown)
        sanitized_markdown = sanitized.sanitized_markdown
        if not sanitized_markdown.strip():
            logger.warning("Sanitized resume content was empty, skipping LLM cleanup")
            return ResumeCleanupResult(cleaned_markdown=raw_markdown)

        system_prompt = (
            "You are a resume formatting assistant. Improve the structure of parsed resume text into clean Markdown.\n"
            "Return a single JSON object with exactly these keys: cleaned_markdown, needs_review, review_reason.\n"
            "Expected JSON shape: {\"cleaned_markdown\":\"## Summary\\n...\",\"needs_review\":false,\"review_reason\":null}.\n"
            "Return JSON only, with no prose, code fences, extra keys, HTML, or XML.\n"
            "Rules:\n"
            "- Detect and format section headings (## level), bullet points, dates, job titles, company names, and education entries.\n"
            "- The input has already had personal/contact data removed. Do NOT add or infer contact info.\n"
            "- Do NOT modify, add, or remove content. Preserve wording and order.\n"
            "- When structure is ambiguous, prefer the minimal interpretation.\n"
            "- Do not introduce em dashes.\n"
            "- Set needs_review to true when the source looks too degraded or ambiguous to structure confidently.\n"
            "- When needs_review is false, set review_reason to null.\n"
            f"\n{build_unslop_prompt_block()}"
        )

        try:
            with trace_llm_scope(
                enabled=self.langsmith_tracing,
                api_key=self.langsmith_api_key,
                project_name=self.langsmith_project,
                name="applix.resume_cleanup",
                inputs={
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": sanitized_markdown},
                    ]
                },
                metadata={
                    "operation": "resume_cleanup",
                    "model": self.openrouter_model,
                    "transport_mode": "http_json",
                    "timeout_seconds": 30.0,
                },
            ) as run_tree:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.openrouter_api_key}",
                            "HTTP-Referer": "https://resume-builder.local",
                            "X-Title": "AI Resume Builder",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.openrouter_model,
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": sanitized_markdown},
                            ],
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    cleaned_body_raw = data["choices"][0]["message"]["content"]
                    payload = _extract_json_payload(cleaned_body_raw)
                    cleaned_body, needs_review, review_reason = _validate_cleanup_payload(payload)
                    cleaned_sanitized = sanitize_resume_markdown(cleaned_body).sanitized_markdown or cleaned_body
                    if run_tree is not None:
                        run_tree.end(
                            outputs=sanitize_trace_data(
                                {
                                    "cleaned_markdown": cleaned_sanitized,
                                    "needs_review": needs_review,
                                    "review_reason": review_reason,
                                }
                            ),
                            metadata=sanitize_trace_data({"provider_usage": data.get("usage") or {}}),
                        )
                    return ResumeCleanupResult(
                        cleaned_markdown=reattach_header_lines(cleaned_sanitized, sanitized.header_lines),
                        needs_review=needs_review,
                        review_reason=review_reason if needs_review else None,
                    )

        except httpx.TimeoutException:
            logger.warning("LLM cleanup timed out after 30 seconds, returning raw markdown")
            return ResumeCleanupResult(cleaned_markdown=raw_markdown)
        except httpx.HTTPStatusError as e:
            logger.warning("LLM cleanup API error: HTTP %s", e.response.status_code)
            return ResumeCleanupResult(cleaned_markdown=raw_markdown)
        except (KeyError, json.JSONDecodeError, TypeError, ValueError):
            logger.warning("LLM cleanup returned invalid structured output")
            return ResumeCleanupResult(cleaned_markdown=raw_markdown)
        except Exception as e:
            logger.warning("LLM cleanup failed (%s)", type(e).__name__)
            return ResumeCleanupResult(cleaned_markdown=raw_markdown)
