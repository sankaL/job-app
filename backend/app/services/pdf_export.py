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
MONTH_YEAR_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b",
    re.I,
)
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
PRESENT_RE = re.compile(r"\b(?:present|current)\b", re.I)
DATE_RANGE_SEPARATOR_RE = re.compile(r"\bto\b|[-/–—]", re.I)
PROFESSIONAL_EXPERIENCE_HEADING = "professional experience"
ONE_PAGE_VALIDATION_ROOMIER_STEPS = 4


@dataclass(frozen=True)
class LayoutPreset:
    body_font_size: float
    line_height: float
    page_margin: float
    spacing_scale: float = 1.0
    section_spacing_scale: float = 1.0

    @property
    def name_font_size(self) -> float:
        return round(self.body_font_size * 1.58, 2)

    @property
    def contact_font_size(self) -> float:
        return round(self.body_font_size * 0.83, 2)

    @property
    def section_heading_size(self) -> float:
        return round(self.body_font_size * 0.95, 2)

    @property
    def section_margin_top(self) -> float:
        return round(self.body_font_size * 0.58 * self.spacing_scale * self.section_spacing_scale, 2)

    @property
    def section_margin_bottom(self) -> float:
        return round(self.body_font_size * 0.24 * self.spacing_scale * self.section_spacing_scale, 2)

    @property
    def paragraph_margin(self) -> float:
        return round(self.body_font_size * 0.16 * self.spacing_scale, 2)

    @property
    def split_row_gap(self) -> float:
        return round(self.body_font_size * 0.52 * self.spacing_scale, 2)

    @property
    def header_margin_bottom(self) -> float:
        return round(self.body_font_size * 0.42 * self.spacing_scale, 2)

    @property
    def subheading_margin_bottom(self) -> float:
        return round(max(0.55, self.paragraph_margin * 0.75), 2)

    @property
    def split_group_margin(self) -> float:
        return round(max(0.55, self.paragraph_margin * 0.82), 2)

    @property
    def list_item_margin_bottom(self) -> float:
        return round(max(0.16, self.paragraph_margin * 0.22), 2)


LAYOUT_PRESETS = [
    # Density-first ladder: tighten spacing before shrinking fonts.
    LayoutPreset(body_font_size=11.8, line_height=1.24, page_margin=0.56, spacing_scale=1.12),
    LayoutPreset(body_font_size=11.8, line_height=1.18, page_margin=0.48, spacing_scale=0.90),
    LayoutPreset(body_font_size=11.2, line_height=1.20, page_margin=0.52, spacing_scale=1.04),
    LayoutPreset(body_font_size=11.2, line_height=1.14, page_margin=0.44, spacing_scale=0.84),
    LayoutPreset(body_font_size=10.6, line_height=1.16, page_margin=0.46, spacing_scale=0.94),
    LayoutPreset(body_font_size=10.6, line_height=1.10, page_margin=0.38, spacing_scale=0.74),
    LayoutPreset(body_font_size=10.0, line_height=1.12, page_margin=0.34, spacing_scale=0.86),
    LayoutPreset(body_font_size=10.0, line_height=1.06, page_margin=0.28, spacing_scale=0.68),
    LayoutPreset(body_font_size=9.4, line_height=1.08, page_margin=0.24, spacing_scale=0.74),
    LayoutPreset(body_font_size=8.8, line_height=1.02, page_margin=0.18, spacing_scale=0.62),
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


def _is_professional_experience_section(section_heading: Optional[str]) -> bool:
    return bool(section_heading and section_heading.strip().lower() == PROFESSIONAL_EXPERIENCE_HEADING)


def _looks_like_experience_date_range(value: str) -> bool:
    normalized = re.sub(r"\s+", " ", value).strip()
    if not normalized:
        return False
    has_month_year = bool(MONTH_YEAR_RE.search(normalized))
    has_year = bool(YEAR_RE.search(normalized))
    has_present = bool(PRESENT_RE.search(normalized))
    has_range_separator = bool(DATE_RANGE_SEPARATOR_RE.search(normalized))
    return (has_month_year or has_year) and (has_range_separator or has_present)


def _render_split_row(left: str, right: str, *, emphasize_left: bool = False) -> str:
    row_class = "split-row split-row-role-title" if emphasize_left else "split-row"
    left_class = "split-left split-left-strong" if emphasize_left else "split-left"
    return (
        f"<div class='{row_class}'>"
        f"<span class='{left_class}'>{_render_inline_markdown(left)}</span>"
        f"<span class='split-right'>{_render_inline_markdown(right)}</span>"
        "</div>"
    )


def _render_content_blocks(lines: list[str], *, section_heading: Optional[str] = None) -> str:
    blocks: list[str] = []
    index = 0
    in_professional_experience = _is_professional_experience_section(section_heading)

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
                    right_column = current_match.group(2).strip()
                    rows.append(
                        _render_split_row(
                            current_match.group(1).strip(),
                            right_column,
                            emphasize_left=(
                                in_professional_experience
                                and _looks_like_experience_date_range(right_column)
                            ),
                        )
                    )
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
            f"{_render_content_blocks(section_lines, section_heading=heading)}"
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
      margin: 0 0 0.5pt 0;
      font-weight: 700;
      line-height: 1;
    }}
    .resume-contact {{
      font-size: {preset.contact_font_size}pt;
      margin: 0;
      line-height: 1.08;
    }}
    .resume-section {{
      margin-top: {preset.section_margin_top}pt;
    }}
    .resume-section:first-of-type {{
      margin-top: 0;
    }}
    .resume-section h2 {{
      margin: 0 0 {preset.section_margin_bottom}pt 0;
      padding-bottom: 0.5pt;
      font-size: {preset.section_heading_size}pt;
      font-weight: 700;
      letter-spacing: 0.015em;
      text-transform: uppercase;
      line-height: 1;
      border-bottom: 0.8pt solid #111111;
    }}
    h3 {{
      margin: 0 0 {preset.subheading_margin_bottom}pt 0;
      font-size: {preset.body_font_size}pt;
      font-weight: 700;
      line-height: 1.05;
    }}
    p {{
      margin: 0 0 {preset.paragraph_margin}pt 0;
    }}
    ul {{
      margin: 0 0 {preset.paragraph_margin}pt 8pt;
      padding-left: 4pt;
    }}
    li {{
      margin: 0 0 {preset.list_item_margin_bottom}pt 0;
      padding-left: 0;
    }}
    .split-group {{
      margin: 0 0 {preset.split_group_margin}pt 0;
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
    .split-left-strong {{
      font-weight: 700;
    }}
    .split-group + ul {{
      margin-top: 0;
    }}
    .split-group + .split-group {{
      margin-top: {preset.split_group_margin}pt;
    }}
    .resume-section > :last-child {{
      margin-bottom: 0;
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


def _build_roomier_one_page_variant(preset: LayoutPreset) -> LayoutPreset:
    return LayoutPreset(
        body_font_size=round(min(12.8, preset.body_font_size + 0.22), 2),
        line_height=round(min(1.32, preset.line_height + 0.02), 2),
        page_margin=preset.page_margin,
        spacing_scale=round(min(1.35, preset.spacing_scale + 0.07), 2),
        section_spacing_scale=round(min(1.75, preset.section_spacing_scale + 0.08), 2),
    )


def _build_section_relief_one_page_variant(preset: LayoutPreset) -> LayoutPreset:
    """Increase section readability spacing without changing typography size."""
    return LayoutPreset(
        body_font_size=preset.body_font_size,
        line_height=preset.line_height,
        page_margin=preset.page_margin,
        spacing_scale=preset.spacing_scale,
        section_spacing_scale=round(min(1.9, preset.section_spacing_scale + 0.14), 2),
    )


def _validate_roomier_one_page_fit(
    markdown_content: str,
    *,
    base_pdf: bytes,
    base_preset: LayoutPreset,
    base_index: int,
) -> bytes:
    """Try readability variants and keep the roomiest one that still fits on one page."""
    best_pdf = base_pdf
    best_preset = base_preset

    for _step in range(ONE_PAGE_VALIDATION_ROOMIER_STEPS):
        improved = False
        for build_candidate in (
            _build_section_relief_one_page_variant,
            _build_roomier_one_page_variant,
        ):
            candidate_preset = build_candidate(best_preset)
            if candidate_preset == best_preset:
                continue
            html_content = _build_html(markdown_content, candidate_preset, preset_index=base_index)
            pdf_bytes, page_count = _render_html_to_pdf(html_content)
            if page_count > 1:
                continue
            best_preset = candidate_preset
            best_pdf = pdf_bytes
            improved = True
        if not improved:
            break

    return best_pdf


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
            if target_pages == 1:
                return _validate_roomier_one_page_fit(
                    normalized_markdown,
                    base_pdf=pdf_bytes,
                    base_preset=preset,
                    base_index=preset_index,
                )
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
