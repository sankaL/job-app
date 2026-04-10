from __future__ import annotations

import re

from app.services import pdf_export


def _personal_info() -> dict[str, str]:
    return {
        "name": "Alex Example",
        "email": "alex@example.com",
        "phone": "555-0100",
        "address": "Toronto, ON",
        "linkedin_url": "https://linkedin.com/in/alex-example",
    }


def test_normalize_markdown_replaces_legacy_placeholder_header():
    normalized = pdf_export._normalize_markdown_for_export(
        "# (Name)\ninvite-only@example.com\n\n## Summary\nBuilt backend systems.\n",
        _personal_info(),
    )

    assert normalized.startswith(
        "# Alex Example\nalex@example.com | 555-0100 | Toronto, ON | in/alex-example\n\n## Summary\n"
    )
    assert "(Name)" not in normalized
    assert "invite-only@example.com" not in normalized


def test_build_html_renders_one_header_for_existing_assembly_header():
    markdown_content = (
        "# Alex Example\n"
        "alex@example.com | 555-0100 | Toronto, ON | in/alex-example\n\n"
        "## Summary\n"
        "Built backend systems.\n"
    )

    html = pdf_export._build_html(markdown_content, pdf_export.LAYOUT_PRESETS[0])

    assert html.count("<header class=\"resume-header\">") == 0
    assert html.count("<header class='resume-header'>") == 1
    assert html.count("<h1>Alex Example</h1>") == 1
    assert "## Summary" not in html
    assert "Built backend systems." in html


def test_normalize_markdown_replaces_plain_text_header_matching_profile():
    normalized = pdf_export._normalize_markdown_for_export(
        "Alex Example\nalex@example.com | 555-0100\n\n## Summary\nBuilt backend systems.\n",
        _personal_info(),
    )

    assert normalized.startswith(
        "# Alex Example\nalex@example.com | 555-0100 | Toronto, ON | in/alex-example\n\n## Summary\n"
    )
    assert "\n\nAlex Example\nalex@example.com | 555-0100\n" not in normalized


def test_build_html_uses_point_spacing_units():
    preset = pdf_export.LAYOUT_PRESETS[0]
    html = pdf_export._build_html(
        "## Summary\nBuilt backend systems.\n",
        preset,
    )

    assert f"margin-top: {preset.section_margin_top}pt;" in html
    assert f"margin: 0 0 {preset.section_margin_bottom}pt 0;" in html
    assert f"margin: 0 0 {preset.paragraph_margin}pt 0;" in html
    assert "margin-top: 0;" in html
    assert f"{preset.section_margin_top}rem" not in html
    assert f"{preset.section_margin_bottom}rem" not in html


def test_generate_pdf_autofit_retries_until_target_page_count_is_met(monkeypatch):
    seen_presets: list[int] = []

    def fake_render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
        preset_index = int(re.search(r'data-preset="(\d+)"', html_content).group(1))
        seen_presets.append(preset_index)
        page_counts = {0: 3, 1: 2, 2: 1}
        return (f"preset-{preset_index}".encode(), page_counts.get(preset_index, 1))

    monkeypatch.setattr(pdf_export, "_render_html_to_pdf", fake_render_html_to_pdf)

    pdf_bytes = pdf_export._generate_pdf_with_autofit_sync(
        "## Summary\nBuilt backend systems.\n",
        _personal_info(),
        "1_page",
    )

    assert pdf_bytes == b"preset-2"
    assert seen_presets[:3] == [0, 1, 2]
    assert all(index == 2 for index in seen_presets[3:])


def test_generate_pdf_autofit_prefers_tighter_density_before_smaller_font(monkeypatch):
    seen_presets: list[int] = []

    def fake_render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
        preset_index = int(re.search(r'data-preset="(\d+)"', html_content).group(1))
        seen_presets.append(preset_index)
        page_counts = {0: 2, 1: 1, 2: 1}
        return (f"preset-{preset_index}".encode(), page_counts.get(preset_index, 1))

    monkeypatch.setattr(pdf_export, "_render_html_to_pdf", fake_render_html_to_pdf)

    pdf_bytes = pdf_export._generate_pdf_with_autofit_sync(
        "## Summary\nBuilt backend systems.\n",
        _personal_info(),
        "1_page",
    )

    assert pdf_bytes == b"preset-1"
    assert seen_presets[:2] == [0, 1]
    assert all(index == 1 for index in seen_presets[2:])


def test_generate_pdf_autofit_stops_at_minimum_preset(monkeypatch):
    seen_presets: list[int] = []

    def fake_render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
        preset_index = int(re.search(r'data-preset="(\d+)"', html_content).group(1))
        seen_presets.append(preset_index)
        return (f"preset-{preset_index}".encode(), 5)

    monkeypatch.setattr(pdf_export, "_render_html_to_pdf", fake_render_html_to_pdf)

    pdf_bytes = pdf_export._generate_pdf_with_autofit_sync(
        "## Summary\nBuilt backend systems.\n",
        _personal_info(),
        "1_page",
    )

    min_preset_index = len(pdf_export.LAYOUT_PRESETS) - 1
    assert pdf_bytes == f"preset-{min_preset_index}".encode()
    assert seen_presets == list(range(len(pdf_export.LAYOUT_PRESETS)))


def test_generate_pdf_one_page_validation_tries_roomier_variant_before_export(monkeypatch):
    seen_fonts: list[float] = []

    monkeypatch.setattr(
        pdf_export,
        "LAYOUT_PRESETS",
        [pdf_export.LayoutPreset(body_font_size=10.0, line_height=1.08, page_margin=0.3, spacing_scale=0.7)],
    )

    def fake_render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
        body_font_size = float(re.search(r"font-size:\s*([0-9.]+)pt;", html_content).group(1))
        seen_fonts.append(body_font_size)
        page_count = 1 if body_font_size <= 10.22 else 2
        return (f"font-{body_font_size:.2f}".encode(), page_count)

    monkeypatch.setattr(pdf_export, "_render_html_to_pdf", fake_render_html_to_pdf)

    pdf_bytes = pdf_export._generate_pdf_with_autofit_sync(
        "## Summary\nBuilt backend systems.\n",
        _personal_info(),
        "1_page",
    )

    assert pdf_bytes == b"font-10.22"
    assert seen_fonts[0] == 10.0
    assert 10.22 in seen_fonts
    assert 10.44 in seen_fonts
    assert len(seen_fonts) >= 3


def test_generate_pdf_one_page_validation_adds_section_spacing_when_room_exists(monkeypatch):
    seen_section_tops: list[float] = []
    accepted_section_tops: list[float] = []

    monkeypatch.setattr(
        pdf_export,
        "LAYOUT_PRESETS",
        [pdf_export.LayoutPreset(body_font_size=10.0, line_height=1.08, page_margin=0.3, spacing_scale=0.7)],
    )

    def fake_render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
        section_margin_top = float(re.search(r"\.resume-section \{\s*margin-top: ([0-9.]+)pt;", html_content).group(1))
        body_font_size = float(re.search(r"font-size:\s*([0-9.]+)pt;", html_content).group(1))
        seen_section_tops.append(section_margin_top)
        # Allow section spacing growth, but force any font growth to overflow.
        page_count = 1 if body_font_size <= 10.0 else 2
        if page_count == 1:
            accepted_section_tops.append(section_margin_top)
        return (f"section-top-{section_margin_top:.2f}".encode(), page_count)

    monkeypatch.setattr(pdf_export, "_render_html_to_pdf", fake_render_html_to_pdf)

    pdf_bytes = pdf_export._generate_pdf_with_autofit_sync(
        "## Summary\nBuilt backend systems.\n",
        _personal_info(),
        "1_page",
    )

    assert seen_section_tops[0] > 0
    assert max(accepted_section_tops) > seen_section_tops[0]
    assert pdf_bytes == f"section-top-{max(accepted_section_tops):.2f}".encode()


def test_build_html_bolds_only_professional_experience_role_title_split_rows():
    html = pdf_export._build_html(
        (
            "## Professional Experience\n"
            "Senior Data Architect | Jan 2020 - Present\n"
            "Acme Corp | Toronto, ON\n"
        ),
        pdf_export.LAYOUT_PRESETS[0],
    )

    assert html.count("split-left split-left-strong") == 1
    assert "Senior Data Architect" in html
    assert "Acme Corp" in html


def test_build_html_does_not_bold_date_split_rows_outside_professional_experience():
    html = pdf_export._build_html(
        (
            "## Summary\n"
            "Program Timeline | Jan 2020 - Present\n"
        ),
        pdf_export.LAYOUT_PRESETS[0],
    )

    assert "split-left split-left-strong" not in html
