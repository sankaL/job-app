from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Optional

FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

HeadingRule = Literal["single", "double", "none"]
HeadingTransform = Literal["uppercase", "small-caps", "none"]


@dataclass(frozen=True)
class ExportFontFace:
    family: str
    filename: str
    weight: int
    style: str = "normal"

    @property
    def path(self) -> Path:
        return FONTS_DIR / self.filename


@dataclass(frozen=True)
class ExportStyle:
    """Visual tokens for one export style.

    Every style is single-column with standard headings so ATS parsing is not
    affected; styles differ only in typography, header treatment, colour and
    spacing. Classic keeps the original export look and adds no CSS overrides.
    """

    key: str
    label: str
    description: str
    docx_font: str
    font_family_css: Optional[str] = None
    font_faces: tuple[ExportFontFace, ...] = field(default_factory=tuple)
    text_color: str = "#111111"
    accent_color: str = "#111111"
    muted_color: str = "#111111"
    header_align: Literal["center", "left"] = "center"
    name_scale: float = 1.0
    name_weight: int = 700
    name_letter_spacing: Optional[str] = None
    heading_transform: HeadingTransform = "uppercase"
    heading_letter_spacing: str = "0.015em"
    heading_align: Literal["left", "center"] = "left"
    heading_rule: HeadingRule = "single"
    heading_rule_width: float = 0.8
    header_rule: HeadingRule = "none"
    section_gap_scale: float = 1.0
    start_preset_index: int = 0
    expand_one_page: bool = True
    docx_size_delta: float = 0.0

    @property
    def is_classic(self) -> bool:
        return self.key == DEFAULT_EXPORT_STYLE


def _faces(family: str, slug: str, weights: tuple[int, ...]) -> tuple[ExportFontFace, ...]:
    return tuple(
        ExportFontFace(family=family, filename=f"{slug}-{weight}-{style}.ttf", weight=weight, style=style)
        for weight in weights
        for style in ("normal", "italic")
    )


DEFAULT_EXPORT_STYLE = "classic"

EXPORT_STYLES: dict[str, ExportStyle] = {
    "classic": ExportStyle(
        key="classic",
        label="Classic",
        description="Traditional serif with a centred name and ruled headings. Safe for any role.",
        docx_font="Georgia",
    ),
    "modern": ExportStyle(
        key="modern",
        label="Modern",
        description="Clean sans-serif, left-aligned header and a navy accent. Suits tech and product roles.",
        docx_font="Calibri",
        font_family_css="'Resume Carlito', 'Calibri', 'DejaVu Sans', sans-serif",
        font_faces=_faces("Resume Carlito", "carlito", (400, 700)),
        text_color="#1a1a1a",
        accent_color="#1f4e79",
        muted_color="#444444",
        header_align="left",
        name_scale=1.14,
        heading_letter_spacing="0.06em",
        heading_rule_width=0.6,
    ),
    "compact": ExportStyle(
        key="compact",
        label="Compact",
        description="Dense, engineering-style layout that fits a long history on fewer pages.",
        docx_font="Arial",
        font_family_css="'Resume Source Sans', 'Arial', 'DejaVu Sans', sans-serif",
        font_faces=_faces("Resume Source Sans", "source-sans-3", (400, 700)),
        heading_transform="small-caps",
        heading_letter_spacing="0.02em",
        heading_rule_width=0.6,
        section_gap_scale=0.8,
        start_preset_index=4,
        expand_one_page=False,
        docx_size_delta=-0.4,
    ),
    "executive": ExportStyle(
        key="executive",
        label="Executive",
        description="Large Garamond name, spaced headings and a double rule. Polished for senior roles.",
        docx_font="Garamond",
        font_family_css="'Resume EB Garamond', 'Garamond', 'DejaVu Serif', serif",
        font_faces=_faces("Resume EB Garamond", "eb-garamond", (400, 700)),
        text_color="#1c1c1c",
        accent_color="#1c1c1c",
        muted_color="#333333",
        name_scale=1.3,
        name_letter_spacing="0.04em",
        heading_letter_spacing="0.16em",
        heading_align="center",
        heading_rule="none",
        header_rule="double",
        section_gap_scale=1.1,
        docx_size_delta=0.3,
    ),
    "minimal": ExportStyle(
        key="minimal",
        label="Minimal",
        description="Light sans-serif with no rules and generous whitespace. Calm and modern.",
        docx_font="Calibri Light",
        font_family_css="'Resume Lato', 'Calibri', 'DejaVu Sans', sans-serif",
        font_faces=_faces("Resume Lato", "lato", (400, 700))
        + (ExportFontFace(family="Resume Lato", filename="lato-300-normal.ttf", weight=300),),
        text_color="#222222",
        accent_color="#222222",
        muted_color="#555555",
        header_align="left",
        name_scale=1.25,
        name_weight=300,
        heading_transform="none",
        heading_letter_spacing="0",
        heading_rule="none",
        section_gap_scale=1.15,
    ),
}


def list_export_styles() -> list[ExportStyle]:
    return list(EXPORT_STYLES.values())


def resolve_style(key: Optional[str]) -> ExportStyle:
    """Return the style for ``key``; ``None`` means the default. Unknown keys fail closed."""
    if key is None:
        return EXPORT_STYLES[DEFAULT_EXPORT_STYLE]
    normalized = key.strip().lower()
    style = EXPORT_STYLES.get(normalized)
    if style is None:
        raise ValueError("Unknown export style.")
    return style


def is_valid_style_key(key: object) -> bool:
    return isinstance(key, str) and key in EXPORT_STYLES
