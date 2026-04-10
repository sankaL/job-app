from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass
from typing import Optional

import markdown

logger = logging.getLogger(__name__)

PDF_EXPORT_TIMEOUT_SECONDS = 20
PAGE_TARGETS = {
    "1_page": 1,
    "2_page": 2,
    "3_page": 3,
}
SECTION_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
TOP_HEADING_RE = re.compile(r"^#\s+(.+?)\s*$")
SUBHEADING_RE = re.compile(r"^###\s+(.+?)\s*$")
PIPE_ROW_RE = re.compile(r"^(.+?)\s*\|\s*(.+)$")
BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?:\+\d[\d\s().-]{6,}|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})")
LINKEDIN_RE = re.compile(r"linkedin\.com/|(?:^|[\s|])(?:in|pub|company)/", re.I)


@dataclass(frozen=True)
class LayoutPreset:
    body_font_size: float
    line_height: float
    page_margin: float

    @property
    def name_font_size(self) -> float:
        return round(self.body_font_size * 1.85, 2)

    @property
    def contact_font_size(self) -> float:
        return round(self.body_font_size * 0.88, 2)

    @property
    def section_heading_size(self) -> float:
        return round(self.body_font_size * 1.03, 2)

    @property
    def section_margin_top(self) -> float:
        return round(self.body_font_size * 1.05, 2)

    @property
    def section_margin_bottom(self) -> float:
        return round(self.body_font_size * 0.4, 2)

    @property
    def paragraph_margin(self) -> float:
        return round(self.body_font_size * 0.38, 2)

    @property
    def split_row_gap(self) -> float:
        return round(self.body_font_size * 0.9, 2)

    @property
    def header_margin_bottom(self) -> float:
        return round(self.body_font_size * 0.9, 2)


LAYOUT_PRESETS = [
    LayoutPreset(body_font_size=11.0, line_height=1.32, page_margin=0.55),
    LayoutPreset(body_font_size=10.5, line_height=1.28, page_margin=0.5),
    LayoutPreset(body_font_size=10.0, line_height=1.24, page_margin=0.45),
    LayoutPreset(body_font_size=9.5, line_height=1.2, page_margin=0.4),
]


def _clean_personal_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _format_linkedin_value(value: object) -> str:
    linkedin = _clean_personal_value(value)
    if not linkedin:
        return ""

    normalized = re.sub(r"^https?://", "", linkedin, flags=re.I)
    normalized = re.sub(r"^www\.", "", normalized, flags=re.I).rstrip("/")
    match = re.search(r"linkedin\.com/(in|pub|company)/(.+)", normalized, re.I)
    if match:
        return f"{match.group(1).lower()}/{match.group(2).strip('/')}"
    return normalized


def _build_contact_parts(personal_info: Optional[dict]) -> list[str]:
    if not personal_info:
        return []

    parts: list[str] = []
    for key in ("email", "phone", "address"):
        value = _clean_personal_value(personal_info.get(key))
        if value:
            parts.append(value)

    linkedin = _format_linkedin_value(personal_info.get("linkedin_url"))
    if linkedin:
        parts.append(linkedin)
    return parts


def _build_header_lines(personal_info: Optional[dict]) -> list[str]:
    if not personal_info:
        return []

    lines: list[str] = []
    name = _clean_personal_value(personal_info.get("name"))
    if name:
        lines.append(f"# {name}")

    contact_parts = _build_contact_parts(personal_info)
    if contact_parts:
        lines.append(" | ".join(contact_parts))

    return lines


def _looks_like_contact_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if "|" in stripped:
        return True
    return bool(
        EMAIL_RE.search(stripped)
        or PHONE_RE.search(stripped)
        or LINKEDIN_RE.search(stripped)
    )


def _join_markdown_parts(header_lines: list[str], body_lines: list[str]) -> str:
    body = "\n".join(body_lines).strip("\n")
    parts: list[str] = []
    if header_lines:
        parts.append("\n".join(header_lines))
    if body:
        parts.append(body)
    if not parts:
        return ""
    return "\n\n".join(parts).rstrip("\n") + "\n"


def _normalize_markdown_for_export(markdown_content: str, personal_info: Optional[dict] = None) -> str:
    stripped_markdown = markdown_content.strip("\n")
    if not stripped_markdown:
        return ""

    lines = stripped_markdown.splitlines()
    first_section_index = next(
        (index for index, line in enumerate(lines) if SECTION_HEADING_RE.match(line.strip())),
        len(lines),
    )
    preamble_lines = lines[:first_section_index]
    body_lines = lines[first_section_index:]

    if not personal_info:
        return stripped_markdown + "\n"

    replacement_header = _build_header_lines(personal_info)
    if not replacement_header:
        return stripped_markdown + "\n"

    nonblank_preamble = [line.strip() for line in preamble_lines if line.strip()]
    profile_name = _clean_personal_value(personal_info.get("name"))

    if not nonblank_preamble:
        return _join_markdown_parts(replacement_header, body_lines)

    first_line = nonblank_preamble[0]
    has_top_heading = bool(TOP_HEADING_RE.match(first_line))
    title = TOP_HEADING_RE.match(first_line).group(1).strip() if has_top_heading else ""
    remaining_lines = nonblank_preamble[1:] if has_top_heading else nonblank_preamble
    plain_remaining_lines = nonblank_preamble[1:]
    all_remaining_contactish = all(_looks_like_contact_line(line) for line in remaining_lines)

    should_replace = False
    if title in {"(Name)", "Resume", "CV"}:
        should_replace = True
    elif any("invite-only@" in line.lower() for line in nonblank_preamble):
        should_replace = True
    elif has_top_heading and profile_name and title == profile_name and all_remaining_contactish:
        should_replace = True
    elif not has_top_heading and profile_name and first_line == profile_name and all(_looks_like_contact_line(line) for line in plain_remaining_lines):
        should_replace = True
    elif not has_top_heading and all(_looks_like_contact_line(line) for line in nonblank_preamble):
        should_replace = True

    if should_replace:
        return _join_markdown_parts(replacement_header, body_lines)

    if not has_top_heading and body_lines:
        return _join_markdown_parts(replacement_header, preamble_lines + body_lines)

    return stripped_markdown + "\n"


def _unwrap_single_paragraph(html_fragment: str) -> str:
    stripped = html_fragment.strip()
    if stripped.startswith("<p>") and stripped.endswith("</p>") and stripped.count("<p>") == 1:
        return stripped[3:-4]
    return stripped


def _render_inline_markdown(text: str) -> str:
    rendered = markdown.markdown(text, extensions=["extra", "sane_lists"])
    return _unwrap_single_paragraph(rendered)


def _render_markdown_block(text: str) -> str:
    return markdown.markdown(text, extensions=["extra", "sane_lists"]).strip()


def _render_split_row(left: str, right: str) -> str:
    return (
        "<div class='split-row'>"
        f"<span class='split-left'>{_render_inline_markdown(left)}</span>"
        f"<span class='split-right'>{_render_inline_markdown(right)}</span>"
        "</div>"
    )


def _render_content_blocks(lines: list[str]) -> str:
    blocks: list[str] = []
    index = 0

    while index < len(lines):
        stripped = lines[index].strip()
        if not stripped:
            index += 1
            continue

        subheading_match = SUBHEADING_RE.match(stripped)
        if subheading_match:
            blocks.append(f"<h3>{html.escape(subheading_match.group(1).strip())}</h3>")
            index += 1
            continue

        if not BULLET_RE.match(stripped):
            pipe_match = PIPE_ROW_RE.match(stripped)
            if pipe_match:
                rows: list[str] = []
                while index < len(lines):
                    current = lines[index].strip()
                    current_match = PIPE_ROW_RE.match(current)
                    if not current or BULLET_RE.match(current) or current_match is None:
                        break
                    rows.append(_render_split_row(current_match.group(1).strip(), current_match.group(2).strip()))
                    index += 1
                if rows:
                    blocks.append(f"<div class='split-group'>{''.join(rows)}</div>")
                    continue

        bullet_match = BULLET_RE.match(stripped)
        if bullet_match:
            items: list[str] = []
            while index < len(lines):
                current = lines[index].strip()
                current_match = BULLET_RE.match(current)
                if current_match is None:
                    break
                items.append(f"<li>{_render_inline_markdown(current_match.group(1).strip())}</li>")
                index += 1
            blocks.append(f"<ul>{''.join(items)}</ul>")
            continue

        paragraph_lines = [stripped]
        index += 1
        while index < len(lines):
            current = lines[index].strip()
            if (
                not current
                or SUBHEADING_RE.match(current)
                or BULLET_RE.match(current)
                or PIPE_ROW_RE.match(current)
            ):
                break
            paragraph_lines.append(current)
            index += 1

        blocks.append(_render_markdown_block("\n".join(paragraph_lines)))

    return "".join(blocks)


def _build_html(markdown_content: str, preset: LayoutPreset, *, preset_index: int = 0) -> str:
    lines = markdown_content.strip().splitlines()
    header_name = ""
    contact_line = ""
    intro_lines: list[str] = []
    sections: list[tuple[str, list[str]]] = []

    index = 0
    while index < len(lines) and not lines[index].strip():
        index += 1

    if index < len(lines):
        top_heading_match = TOP_HEADING_RE.match(lines[index].strip())
        if top_heading_match:
            header_name = top_heading_match.group(1).strip()
            index += 1
            while index < len(lines):
                stripped = lines[index].strip()
                if SECTION_HEADING_RE.match(stripped):
                    break
                if stripped:
                    if not contact_line and _looks_like_contact_line(stripped):
                        contact_line = stripped
                    else:
                        intro_lines.append(lines[index])
                index += 1

    current_heading: Optional[str] = None
    current_lines: list[str] = []
    while index < len(lines):
        stripped = lines[index].strip()
        section_match = SECTION_HEADING_RE.match(stripped)
        if section_match:
            if current_heading is not None:
                sections.append((current_heading, current_lines))
            current_heading = section_match.group(1).strip()
            current_lines = []
        else:
            current_lines.append(lines[index])
        index += 1

    if current_heading is not None:
        sections.append((current_heading, current_lines))

    intro_html = _render_content_blocks(intro_lines)
    sections_html = "".join(
        (
            "<section class='resume-section'>"
            f"<h2>{html.escape(heading)}</h2>"
            f"{_render_content_blocks(section_lines)}"
            "</section>"
        )
        for heading, section_lines in sections
    )
    header_html = ""
    if header_name or contact_line:
        contact_html = f"<p class='resume-contact'>{html.escape(contact_line)}</p>" if contact_line else ""
        header_html = (
            "<header class='resume-header'>"
            f"<h1>{html.escape(header_name)}</h1>"
            f"{contact_html}"
            "</header>"
        )

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {{
      size: Letter;
      margin: {preset.page_margin}in;
    }}
    body {{
      margin: 0;
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: {preset.body_font_size}pt;
      line-height: {preset.line_height};
      color: #111111;
    }}
    .resume-root {{
      width: 100%;
    }}
    .resume-header {{
      text-align: center;
      margin-bottom: {preset.header_margin_bottom}pt;
    }}
    .resume-header h1 {{
      font-size: {preset.name_font_size}pt;
      margin: 0 0 3pt 0;
      font-weight: 700;
      line-height: 1.05;
    }}
    .resume-contact {{
      font-size: {preset.contact_font_size}pt;
      margin: 0;
      line-height: 1.2;
    }}
    .resume-section {{
      margin-top: {preset.section_margin_top}pt;
    }}
    .resume-section h2 {{
      margin: 0 0 {preset.section_margin_bottom}pt 0;
      padding-bottom: 2pt;
      font-size: {preset.section_heading_size}pt;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      border-bottom: 1pt solid #111111;
    }}
    h3 {{
      margin: {preset.paragraph_margin}pt 0 2pt 0;
      font-size: {preset.body_font_size}pt;
      font-weight: 700;
    }}
    p {{
      margin: {preset.paragraph_margin}pt 0;
    }}
    ul {{
      margin: {preset.paragraph_margin}pt 0 {preset.paragraph_margin}pt 14pt;
      padding-left: 8pt;
    }}
    li {{
      margin: 0.08rem 0;
      padding-left: 0.08rem;
    }}
    .split-group {{
      margin: {preset.paragraph_margin}pt 0;
    }}
    .split-row {{
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: {preset.split_row_gap}pt;
      width: 100%;
      margin: 0;
    }}
    .split-left {{
      flex: 1 1 auto;
      min-width: 0;
    }}
    .split-right {{
      flex: 0 0 auto;
      text-align: right;
      white-space: nowrap;
    }}
    strong {{
      font-weight: 700;
    }}
    em {{
      font-style: italic;
    }}
  </style>
</head>
<body data-preset="{preset_index}">
  <main class="resume-root">
    {header_html}
    {intro_html}
    {sections_html}
  </main>
</body>
</html>"""


def _render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
    """Render HTML to PDF bytes and report the resulting page count."""
    import weasyprint  # noqa: WPS433 — deferred import

    document = weasyprint.HTML(string=html_content).render()
    return document.write_pdf(), len(document.pages)


def _generate_pdf_with_autofit_sync(
    markdown_content: str,
    personal_info: Optional[dict] = None,
    page_length: Optional[str] = None,
) -> bytes:
    normalized_markdown = _normalize_markdown_for_export(markdown_content, personal_info)
    target_pages = PAGE_TARGETS.get(str(page_length or "1_page"), 1)

    last_pdf = b""
    for preset_index, preset in enumerate(LAYOUT_PRESETS):
        html_content = _build_html(normalized_markdown, preset, preset_index=preset_index)
        pdf_bytes, page_count = _render_html_to_pdf(html_content)
        last_pdf = pdf_bytes
        if page_count <= target_pages:
            return pdf_bytes

    return last_pdf


async def generate_pdf(
    markdown_content: str,
    personal_info: Optional[dict] = None,
    page_length: Optional[str] = None,
) -> bytes:
    """Convert Markdown to ATS-safe PDF with header normalization and page-fit retries."""
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(
        loop.run_in_executor(
            None,
            _generate_pdf_with_autofit_sync,
            markdown_content,
            personal_info,
            page_length,
        ),
        timeout=PDF_EXPORT_TIMEOUT_SECONDS,
    )
