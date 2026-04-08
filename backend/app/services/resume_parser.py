from __future__ import annotations

import io
import logging
import re
from typing import Optional

import httpx

from app.services.resume_privacy import reattach_header_lines, sanitize_resume_markdown

logger = logging.getLogger(__name__)


class ResumeParserService:
    """Service for parsing PDF resumes and optionally cleaning them up with LLM."""

    def __init__(
        self,
        openrouter_api_key: Optional[str] = None,
        openrouter_model: str = "openai/gpt-4o-mini",
    ) -> None:
        self.openrouter_api_key = openrouter_api_key
        self.openrouter_model = openrouter_model

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

        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page_num, page in enumerate(pdf.pages):
                text = page.extract_text()
                if not text:
                    continue

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

    async def cleanup_with_llm(self, raw_markdown: str) -> str:
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
            return raw_markdown

        sanitized = sanitize_resume_markdown(raw_markdown)
        sanitized_markdown = sanitized.sanitized_markdown
        if not sanitized_markdown.strip():
            logger.warning("Sanitized resume content was empty, skipping LLM cleanup")
            return raw_markdown

        system_prompt = (
            "You are a resume formatting assistant. Your job is to improve the structure "
            "of parsed resume text into clean Markdown. Detect and format section headings "
            "(## level), bullet points, dates, job titles, company names, education entries. "
            "The input has already had personal/contact data removed. Do NOT add or infer contact info. "
            "Do NOT modify, add, or remove any content - only improve formatting and structure. "
            "Return only the formatted Markdown body without personal/contact header lines."
        )

        try:
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
                cleaned_body = data["choices"][0]["message"]["content"]
                cleaned_sanitized = sanitize_resume_markdown(cleaned_body).sanitized_markdown or cleaned_body
                return reattach_header_lines(cleaned_sanitized, sanitized.header_lines)

        except httpx.TimeoutException:
            logger.warning("LLM cleanup timed out after 30 seconds, returning raw markdown")
            return raw_markdown
        except httpx.HTTPStatusError as e:
            logger.warning(
                "LLM cleanup API error: %s - %s",
                e.response.status_code,
                e.response.text[:200] if e.response.text else "no details",
            )
            return raw_markdown
        except Exception as e:
            logger.warning("LLM cleanup failed: %s", str(e))
            return raw_markdown
