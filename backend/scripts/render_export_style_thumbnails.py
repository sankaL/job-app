"""Render the export-style preview thumbnails shown in the Export modal.

Uses the real PDF renderer with a fictional sample resume, so the previews stay
faithful to downloads. Run inside the backend container after changing a style:

    python scripts/render_export_style_thumbnails.py /tmp/export-styles

then copy the PNGs into ``frontend/public/export-styles/``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pypdfium2

from app.services.export_styles import list_export_styles
from app.services.pdf_export import _generate_pdf_with_autofit_sync

THUMBNAIL_WIDTH_PX = 480

SAMPLE_PERSONAL_INFO = {
    "name": "Jordan Rivera",
    "email": "jordan.rivera@example.com",
    "phone": "(555) 010-0199",
    "address": "Toronto, ON",
    "linkedin_url": "https://linkedin.com/in/jordan-rivera",
}

SAMPLE_MARKDOWN = """## Summary
Product-minded software engineer with eight years building data platforms and customer-facing web apps. Known for turning ambiguous problems into shipped, measurable outcomes.

## Professional Experience
Northwind Analytics | Toronto, ON
Senior Software Engineer | Mar 2021 - Present
- Led a team of five to rebuild the reporting pipeline, cutting dashboard load times by 62%.
- Designed an event-driven ingestion service processing 40M records per day.
- Mentored three junior engineers through promotion to intermediate level.

Bluebird Health | Ottawa, ON
Software Engineer | Jun 2017 - Feb 2021
- Shipped a patient scheduling app used by 120 clinics across Ontario.
- Introduced automated testing that reduced production incidents by 35%.
- Partnered with design to run usability studies that shaped the booking flow.

Lakeside Digital | Kingston, ON
Junior Developer | Sep 2015 - May 2017
- Built responsive marketing sites for regional retail clients.
- Maintained internal tooling for content publishing.

## Education
Queen's University | Kingston, ON
B.Sc. Computer Science | 2015

## Skills
Python, TypeScript, React, PostgreSQL, AWS, Kafka, Docker, CI/CD, System Design
"""


def main(output_dir: str) -> None:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    for style in list_export_styles():
        pdf_bytes = _generate_pdf_with_autofit_sync(SAMPLE_MARKDOWN, SAMPLE_PERSONAL_INFO, "1_page", style)
        pdf = pypdfium2.PdfDocument(pdf_bytes)
        try:
            page = pdf[0]
            scale = THUMBNAIL_WIDTH_PX / page.get_width()
            image = page.render(scale=scale).to_pil()
            image.save(out / f"{style.key}.png", optimize=True)
        finally:
            pdf.close()
        print(f"rendered {style.key}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: render_export_style_thumbnails.py <output-dir>")
    main(sys.argv[1])
