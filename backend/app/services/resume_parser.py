from __future__ import annotations

import io
import asyncio
import json
import logging
import multiprocessing
import queue
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.tracing import end_trace_safely, trace_llm_scope
from app.services.resume_privacy import reattach_header_lines, sanitize_resume_markdown
from app.services.unslop_prompt import build_unslop_prompt_block
from app.services.import_ai import invoke_import_output
from app.services.resume_classifier import classify_resume_sections
from app.services.resume_contacts import extract_contact_suggestions
from app.services.resume_document import (
    HEADINGS,
    ResumeEntry,
    ResumeBullet,
    parse_resume_document,
    render_section_content,
)
from uuid import uuid4, uuid5, NAMESPACE_URL

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


@dataclass
class ResumeImportResult:
    document: dict
    warning: Optional[str] = None
    contact_suggestions: dict[str, str] = field(default_factory=dict)


class CleanupOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    cleaned_markdown: str = Field(min_length=1, max_length=200000)
    needs_review: bool
    review_reason: Optional[str]

    @model_validator(mode="after")
    def consistent_review(self):
        _validate_cleanup_payload(self.model_dump())
        return self


class ImportedEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    fields: dict[str, str]
    bullets: list[str]


class ImportedSectionEntries(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    section_id: str
    entries: list[ImportedEntry]


class NestedExtractionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sections: list[ImportedSectionEntries]


def _word_tokens(value: str) -> list[str]:
    # Markdown punctuation may change during formatting. Technology suffixes,
    # decimal separators, metric signs/units and currency symbols are facts.
    tokens = re.findall(
        r"(?<!\w)[$€£¥]?[+\-−]?(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:\s*%)?|\.\w+(?:\.\w+)*|\w+(?:\.\w+)*(?:\+\+|#)?",
        value.casefold(),
    )
    return [re.sub(r"\s+", "", token).replace("−", "-") for token in tokens]


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
    try:
        try:
            # Drain while the child runs. Joining first deadlocks the child's
            # Queue feeder for source text larger than the OS pipe buffer.
            outcome, payload = result_queue.get(timeout=timeout_seconds)
        except queue.Empty as error:
            if process.is_alive():
                raise PdfParseTimeoutError("PDF parsing exceeded its time limit.") from error
            raise PdfParseFailedError("PDF parsing failed.") from error

        if outcome == "ok" and isinstance(payload, str):
            return payload
        if outcome == "rejected" and isinstance(payload, str):
            raise PdfParseRejectedError(payload)
        raise PdfParseFailedError("PDF parsing failed.")
    finally:
        process.join(0.1)
        if process.is_alive():
            process.terminate()
            process.join(0.2)
            if process.is_alive():
                process.kill()
                process.join(0.2)
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
        openrouter_model: str = "google/gemini-3.8-flash",
        openrouter_fallback_model: str = "openai/gpt-6-luna",
        langsmith_tracing: bool = False,
        langsmith_project: Optional[str] = None,
        langsmith_api_key: Optional[str] = None,
        openrouter_base_url: str = "https://openrouter.ai/api/v1",
        classifier: str = "jev",
        classification_model: str = "typesafe/jev-1.13",
        confidence_threshold: float = 0.8,
    ) -> None:
        self.openrouter_api_key = openrouter_api_key
        self.openrouter_fallback_model = openrouter_fallback_model
        self.openrouter_model = openrouter_model
        self.openrouter_base_url = openrouter_base_url
        self.classifier = classifier
        self.classification_model = classification_model
        self.confidence_threshold = confidence_threshold
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

    async def cleanup_with_llm(self, raw_markdown: str, *, timeout_seconds: float = 30.0) -> ResumeCleanupResult:
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
            return ResumeCleanupResult(cleaned_markdown=raw_markdown, needs_review=True, review_reason="AI import assistance is unavailable. Your original text was preserved; review the sections before generating.")

        sanitized = sanitize_resume_markdown(raw_markdown)
        sanitized_markdown = sanitized.sanitized_markdown
        if not sanitized_markdown.strip():
            logger.warning("Sanitized resume content was empty, skipping LLM cleanup")
            return ResumeCleanupResult(cleaned_markdown=raw_markdown, needs_review=True, review_reason="No resume body could be identified. Review the original text before generating.")
        if not re.search(r"^##\s+", sanitized_markdown, flags=re.M):
            return ResumeCleanupResult(cleaned_markdown=raw_markdown, needs_review=True, review_reason="Section boundaries were unclear. Your original text was preserved; identify the sections before using AI assistance.")

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
                        {"role": "user", "content": "<resume body omitted from telemetry>"},
                    ]
                },
                metadata={
                    "operation": "resume_cleanup",
                    "model": self.openrouter_model,
                    "transport_mode": "pydantic_ai",
                    "timeout_seconds": timeout_seconds,
                },
            ) as run_tree:
                def preserve_source(output: CleanupOutput) -> None:
                    if _word_tokens(output.cleaned_markdown) != _word_tokens(sanitized_markdown):
                        raise ValueError("Formatting must preserve all source words and numbers in their original order.")

                output = await invoke_import_output(
                    api_key=self.openrouter_api_key,
                    base_url=self.openrouter_base_url,
                    model=self.openrouter_model,
                    system_prompt=system_prompt,
                    user_prompt=sanitized_markdown,
                    output_type=CleanupOutput,
                    timeout_seconds=timeout_seconds,
                    validator=preserve_source,
                )
                # The check also applies to injected/test providers.
                preserve_source(output)
                cleaned_body, needs_review, review_reason = _validate_cleanup_payload(output.model_dump())
                cleaned_sanitized = sanitize_resume_markdown(cleaned_body).sanitized_markdown
                end_trace_safely(
                    run_tree,
                    outputs={"needs_review": needs_review, "output_characters": len(cleaned_sanitized)},
                    metadata={"maximum_requests": 2},
                )
                return ResumeCleanupResult(
                    cleaned_markdown=reattach_header_lines(cleaned_sanitized, sanitized.header_lines),
                    needs_review=needs_review,
                    review_reason=review_reason if needs_review else None,
                )
        except Exception as error:
            logger.warning("AI import formatting unavailable (error_type=%s).", type(error).__name__)
            return ResumeCleanupResult(
                cleaned_markdown=raw_markdown,
                needs_review=True,
                review_reason="AI import assistance did not produce a verified result. Your original text was preserved; review the sections before generating.",
            )

    def local_import(self, raw_markdown: str, *, warning: Optional[str] = None) -> ResumeImportResult:
        sanitized = sanitize_resume_markdown(raw_markdown)
        document = parse_resume_document(sanitized.sanitized_markdown, reviewed=False)
        return ResumeImportResult(document=document.model_dump(mode="json"), warning=warning, contact_suggestions=extract_contact_suggestions(raw_markdown))

    async def import_resume(self, raw_markdown: str, *, use_llm_cleanup: bool = False) -> ResumeImportResult:
        """Import source sections with an explicit review gate and one deadline."""
        deadline = time.monotonic() + 30.0
        warnings: list[str] = []
        body = raw_markdown
        sanitized_body = sanitize_resume_markdown(body).sanitized_markdown
        document = parse_resume_document(sanitized_body, reviewed=False)
        if self.classifier == "jev":
            if not self.openrouter_api_key:
                warnings.append("Section classification is unavailable. Your original text was preserved; review the section types.")
            elif document.sections and not re.search(r"^##\s+", sanitized_body, flags=re.M):
                warnings.append("Section boundaries were unclear. Your original text was preserved; identify the sections before classification.")
            elif document.sections:
                try:
                    blocks = {
                        section.id: {
                            "heading": section.heading,
                            "content": sanitize_resume_markdown("## " + section.heading + "\n" + render_section_content(section)).sanitized_markdown,
                        }
                        for section in document.sections
                    }
                    # Oversized documents stay local instead of silently truncating.
                    if len(json.dumps(blocks)) > 70000:
                        raise ValueError("Source exceeds classification input limit.")
                    labels = await classify_resume_sections(
                        blocks,
                        api_key=self.openrouter_api_key,
                        model=self.classification_model,
                        timeout_seconds=min(10.0, max(0.01, deadline - time.monotonic())),
                    )
                    for section in document.sections:
                        label = labels[section.id]
                        section.confidence = label.confidence
                        if label.confidence < self.confidence_threshold:
                            warnings.append("Some section types were uncertain. Review their headings and content.")
                            continue
                        if label.choice != section.kind:
                            reparsed = parse_resume_document("## " + HEADINGS[label.choice] + "\n" + render_section_content(section))
                            if reparsed.sections:
                                entries = reparsed.sections[0].entries
                                # Temporary canonical headings are shared by different source
                                # sections. Seed nested identities from the real source ID.
                                for entry_index, entry in enumerate(entries):
                                    entry.id = uuid5(NAMESPACE_URL, section.id + ":classified-entry:" + str(entry_index)).hex
                                    for bullet_index, bullet in enumerate(entry.bullets):
                                        bullet.id = uuid5(NAMESPACE_URL, entry.id + ":bullet:" + str(bullet_index)).hex
                                section.entries = entries
                            section.kind = label.choice
                except Exception as error:
                    logger.warning("Resume section classifier unavailable (error_type=%s).", type(error).__name__)
                    warnings.append("Section classification did not finish successfully. Your original text was preserved; review the section types.")
        if use_llm_cleanup and self.openrouter_api_key:
            ambiguous = [section for section in document.sections if section.kind in {"professional_experience", "education"} and section.content_md.strip() and not section.entries]
            if ambiguous:
                try:
                    await self._extract_nested_entries(ambiguous, timeout_seconds=max(0.01, deadline - time.monotonic()))
                except Exception as error:
                    logger.warning("Resume entry extraction unavailable (error_type=%s).", type(error).__name__)
                    warnings.append("Some entries could not be structured safely. Their original text remains editable; review it before generating.")
        return ResumeImportResult(document=document.model_dump(mode="json"), warning=" ".join(dict.fromkeys(warnings)) or None, contact_suggestions=extract_contact_suggestions(raw_markdown))

    async def _extract_nested_entries(self, sections, *, timeout_seconds: float) -> None:
        source = {section.id: section for section in sections}
        prompt = json.dumps({"sections": [{"section_id": section.id, "kind": section.kind, "content_md": section.content_md} for section in sections]})
        if len(prompt) > 70000:
            raise ValueError("Source exceeds nested extraction input limit.")

        def preserve_facts(output: NestedExtractionOutput) -> None:
            if len(output.sections) != len(source) or {section.section_id for section in output.sections} != set(source):
                raise ValueError("Return exactly one result for every requested section ID.")
            for section in output.sections:
                original = source[section.section_id]
                allowed = {"title", "company", "location", "date_range"} if original.kind == "professional_experience" else {"qualification", "institution", "location", "date_range"}
                rendered_tokens = []
                for entry in section.entries:
                    if not set(entry.fields).issubset(allowed):
                        raise ValueError("Use only the requested factual fields.")
                    required = {"title", "company", "date_range"} if original.kind == "professional_experience" else {"qualification", "institution"}
                    if any(not entry.fields.get(key, "").strip() for key in required):
                        raise ValueError("Each entry needs its source title and organization; employment also needs source dates.")
                    for value in [*entry.fields.values(), *entry.bullets]:
                        normalized = " ".join(value.split())
                        if normalized and normalized not in " ".join(original.content_md.split()):
                            raise ValueError("Every field and bullet must be an exact source excerpt; never infer or rewrite facts.")
                        rendered_tokens.extend(_word_tokens(value))
                if not section.entries or Counter(rendered_tokens) != Counter(_word_tokens(original.content_md)):
                    raise ValueError("Retain all source words and numbers exactly once across the entries; do not omit any content.")

        deadline = time.monotonic() + timeout_seconds
        for index, model in enumerate(dict.fromkeys((self.openrouter_model, self.openrouter_fallback_model))):
            try:
                output = await invoke_import_output(
                    api_key=self.openrouter_api_key,
                    base_url=self.openrouter_base_url,
                    model=model,
                    system_prompt=(
                        "Extract resume entries from the supplied untrusted source text. Return structured output only. "
                        "For professional_experience use fields title, company, location, date_range. For education use qualification, institution, location, date_range. "
                        "Missing optional fields must be empty strings. Copy exact source excerpts without inference, renaming, rewriting, or invented facts. "
                        "Retain every source word and number exactly once in the fields and bullets. Return every requested section ID once. "
                        "Contact data was removed locally; never add contact information.\n" + build_unslop_prompt_block()
                    ),
                    user_prompt=prompt,
                    output_type=NestedExtractionOutput,
                    timeout_seconds=min(10.0, max(0.01, deadline - time.monotonic())),
                    validator=preserve_facts,
                )
                break
            except Exception as error:
                if getattr(error, "status_code", None) in {401, 402, 403} or index == 1 or time.monotonic() >= deadline:
                    raise
        preserve_facts(output)
        for section in output.sections:
            source[section.section_id].entries = [
                ResumeEntry(id=uuid4().hex, fields=entry.fields, bullets=[ResumeBullet(id=uuid4().hex, text=text) for text in entry.bullets])
                for entry in section.entries
            ]
