from __future__ import annotations

import re

import pytest

from app.services.export_filename import (
    build_filename_values,
    content_disposition,
    render_filename,
    validate_template,
)


def _values(**overrides):
    return build_filename_values(
        full_name=overrides.pop("full_name", "Sanka Lokuliyana"),
        **overrides,
    )


def test_default_template_is_first_last_resume():
    assert render_filename(None, _values(), "pdf") == "Sanka Lokuliyana Resume.pdf"


def test_middle_names_use_first_and_last_tokens_but_full_name_keeps_all():
    values = _values(full_name="Mary Jane  Smith")
    assert render_filename(None, values, "docx") == "Mary Smith Resume.docx"
    assert render_filename("{full name} CV", values, "pdf") == "Mary Jane Smith CV.pdf"


def test_placeholders_are_case_and_space_insensitive():
    values = _values(company="Acme", job_title="Data Engineer")
    assert render_filename("{First Name} {LAST  NAME} - {company} {Job Title}", values, "pdf") == (
        "Sanka Lokuliyana - Acme Data Engineer.pdf"
    )


def test_empty_placeholder_values_are_dropped_cleanly():
    assert render_filename("{full name} Resume {company}", _values(company=""), "pdf") == "Sanka Lokuliyana Resume.pdf"


def test_underscores_and_special_characters_become_single_spaces():
    values = _values(company="Acme/Labs: R&D_Group", job_title="Sr. Engineer*")
    assert render_filename("{company}__{job title}", values, "pdf") == "Acme Labs R&D Group Sr. Engineer.pdf"


def test_template_rendering_to_nothing_falls_back_to_default():
    assert render_filename("{company}", _values(company=""), "pdf") == "Sanka Lokuliyana Resume.pdf"


def test_missing_profile_name_falls_back_to_onboarding_names_then_resume():
    values = build_filename_values(full_name="", first_name="Ada", last_name="Lovelace")
    assert render_filename(None, values, "pdf") == "Ada Lovelace Resume.pdf"
    assert render_filename(None, build_filename_values(full_name=None), "pdf") == "Resume.pdf"


def test_unicode_names_are_kept_and_header_has_ascii_fallback():
    filename = render_filename(None, _values(full_name="José Núñez"), "pdf")
    assert filename == "José Núñez Resume.pdf"
    assert content_disposition(filename) == (
        "attachment; filename=\"Jose Nunez Resume.pdf\"; filename*=UTF-8''Jos%C3%A9%20N%C3%BA%C3%B1ez%20Resume.pdf"
    )


def test_long_names_are_capped():
    filename = render_filename("x" * 120 + " {job title}", _values(job_title="y" * 50), "pdf")
    assert len(filename) <= 124


@pytest.mark.parametrize("template", [None, "", "   "])
def test_blank_template_means_default(template):
    assert validate_template(template) is None


def test_validate_template_trims_and_accepts_known_placeholders():
    assert validate_template("  {first name} {last name} Resume {company} ") == "{first name} {last name} Resume {company}"


@pytest.mark.parametrize(
    ("template", "message"),
    [
        ("{salary} Resume", "Unknown placeholder"),
        ("{first name Resume", "unmatched"),
        ("x" * 121, "120 characters"),
        ("___", "letters or numbers"),
    ],
)
def test_validate_template_rejects_invalid_templates(template, message):
    with pytest.raises(ValueError, match=message):
        validate_template(template)


@pytest.mark.parametrize(
    "full_name",
    ["सचिन तेंदुलकर", "සංකල් ලොකුලියන", "தமிழ் செல்வன்", "สมชาย ใจดี"],
)
def test_combining_marks_in_non_latin_names_are_preserved(full_name):
    first, *_rest, last = full_name.split()
    assert render_filename(None, _values(full_name=full_name), "pdf") == f"{first} {last} Resume.pdf"


@pytest.mark.parametrize("stem", ["CON", "nul", "Com1", "LPT9"])
def test_windows_reserved_stems_are_made_safe(stem):
    assert render_filename(stem, _values(), "pdf") == f"{stem} Resume.pdf"


def test_export_style_constraint_in_migration_matches_registry():
    from pathlib import Path

    from app.services.export_styles import EXPORT_STYLES

    candidates = [
        Path("/supabase/migrations"),
        Path(__file__).resolve().parents[2] / "supabase" / "migrations",
    ]
    migrations = next((path for path in candidates if path.is_dir()), None)
    if migrations is None:
        pytest.skip("supabase migrations are not mounted")
    sql = (migrations / "20261012_000025_export_styles_and_filenames.sql").read_text()
    constraint = re.search(r"export_style in \(([^)]*)\)", sql)
    assert constraint is not None
    assert set(re.findall(r"'([a-z]+)'", constraint.group(1))) == set(EXPORT_STYLES)
