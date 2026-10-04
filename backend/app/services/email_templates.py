from __future__ import annotations

import html
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

# Brand tokens mirror frontend/src/index.css (ink, canvas, spruce).
BRAND_NAME = "Applix"
COLOR_INK = "#101828"
COLOR_MUTED = "#667085"
COLOR_CANVAS = "#f5f3ee"
COLOR_SURFACE = "#ffffff"
COLOR_SPRUCE = "#184a45"
COLOR_BORDER = "#e4e0d6"
FONT_STACK = "'Source Sans 3', Helvetica, Arial, sans-serif"


@dataclass(frozen=True)
class BrandedEmail:
    html: str
    text: str


def _escape(value: str) -> str:
    return html.escape(value, quote=True)


def _paragraphs(body: str) -> str:
    blocks = [block.strip() for block in body.split("\n\n") if block.strip()]
    return "".join(
        f'<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:{COLOR_INK};">'
        f'{_escape(block).replace(chr(10), "<br>")}</p>'
        for block in blocks
    )


def render_branded_email(
    *,
    eyebrow: str,
    heading: str,
    body: str,
    cta_label: Optional[str] = None,
    cta_url: Optional[str] = None,
    details: Sequence[Tuple[str, str]] = (),
    footnote: Optional[str] = None,
) -> BrandedEmail:
    """Render the shared Applix email layout as table-based, inline-styled HTML plus plain text.

    All caller-supplied values are escaped here, so callers pass raw strings.
    """
    details_html = ""
    if details:
        rows = "".join(
            f'<tr><td style="padding:6px 12px 6px 0;font-size:14px;color:{COLOR_MUTED};'
            f'vertical-align:top;white-space:nowrap;">{_escape(label)}</td>'
            f'<td style="padding:6px 0;font-size:14px;color:{COLOR_INK};">'
            f'{_escape(value).replace(chr(10), "<br>")}</td></tr>'
            for label, value in details
        )
        details_html = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:0 0 20px;border-top:1px solid {COLOR_BORDER};width:100%;">{rows}</table>'
        )

    cta_html = ""
    if cta_label and cta_url:
        safe_url = _escape(cta_url)
        cta_html = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">'
            f'<tr><td style="border-radius:10px;background:{COLOR_SPRUCE};">'
            f'<a href="{safe_url}" style="display:inline-block;padding:12px 22px;'
            f'font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">'
            f"{_escape(cta_label)}</a></td></tr></table>"
            f'<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:{COLOR_MUTED};">'
            f"If the button doesn't work, copy and paste this link into your browser:<br>"
            f'<a href="{safe_url}" style="color:{COLOR_SPRUCE};word-break:break-all;">{safe_url}</a></p>'
        )

    footnote_html = (
        f'<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:{COLOR_MUTED};">{_escape(footnote)}</p>'
        if footnote
        else ""
    )

    document = (
        "<!doctype html>"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light only">'
        f"<title>{_escape(heading)}</title></head>"
        f'<body style="margin:0;padding:0;background:{COLOR_CANVAS};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:{COLOR_CANVAS};"><tr><td align="center" style="padding:32px 16px;">'
        f'<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;max-width:560px;font-family:{FONT_STACK};">'
        # Header
        f'<tr><td style="padding:0 4px 16px;font-size:22px;font-weight:700;letter-spacing:-0.01em;'
        f'color:{COLOR_SPRUCE};">{BRAND_NAME}</td></tr>'
        # Card
        f'<tr><td style="background:{COLOR_SURFACE};border:1px solid {COLOR_BORDER};border-radius:16px;'
        f'padding:28px;">'
        f'<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;'
        f'color:{COLOR_SPRUCE};">{_escape(eyebrow)}</p>'
        f'<h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:{COLOR_INK};">{_escape(heading)}</h1>'
        f"{_paragraphs(body)}{details_html}{cta_html}{footnote_html}"
        "</td></tr>"
        # Footer
        f'<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:{COLOR_MUTED};">'
        f"{BRAND_NAME} &middot; AI-assisted resume tailoring. "
        "You received this email because of activity on your account."
        "</td></tr>"
        "</table></td></tr></table></body></html>"
    )

    text_parts = [heading, "", body]
    if details:
        text_parts.append("")
        text_parts.extend(f"{label}: {value}" for label, value in details)
    if cta_label and cta_url:
        text_parts.extend(["", f"{cta_label}: {cta_url}"])
    if footnote:
        text_parts.extend(["", footnote])
    text_parts.extend(["", f"-- {BRAND_NAME}"])

    return BrandedEmail(html=document, text="\n".join(text_parts))
