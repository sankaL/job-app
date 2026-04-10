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
    html = pdf_export._build_html(
        "## Summary\nBuilt backend systems.\n",
        pdf_export.LAYOUT_PRESETS[0],
    )

    assert "margin-top: 11.55pt;" in html
    assert "margin-bottom: 9.9pt;" in html
    assert "margin: 4.18pt 0;" in html
    assert "11.55rem" not in html
    assert "9.9rem" not in html


def test_generate_pdf_autofit_retries_until_target_page_count_is_met(monkeypatch):
    seen_presets: list[int] = []

    def fake_render_html_to_pdf(html_content: str) -> tuple[bytes, int]:
        preset_index = int(re.search(r'data-preset="(\d+)"', html_content).group(1))
        seen_presets.append(preset_index)
        page_counts = {0: 3, 1: 2, 2: 1}
        return (f"preset-{preset_index}".encode(), page_counts[preset_index])

    monkeypatch.setattr(pdf_export, "_render_html_to_pdf", fake_render_html_to_pdf)

    pdf_bytes = pdf_export._generate_pdf_with_autofit_sync(
        "## Summary\nBuilt backend systems.\n",
        _personal_info(),
        "1_page",
    )

    assert pdf_bytes == b"preset-2"
    assert seen_presets == [0, 1, 2]


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

    assert pdf_bytes == b"preset-3"
    assert seen_presets == [0, 1, 2, 3]
