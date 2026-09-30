"""Versioned resume source contract; mirrored in the separately deployed worker.

Markdown remains editable content. IDs, reviewed facts and provenance make section
operations independent of headings and text similarity. Contact belongs to profile.
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from uuid import uuid5, NAMESPACE_URL

from pydantic import BaseModel, ConfigDict, Field, model_validator

SectionKind = Literal['summary', 'professional_experience', 'education', 'certifications', 'projects', 'skills', 'custom']
ResumeId = Annotated[str, Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')]
HEADINGS = {'summary': 'Summary', 'professional_experience': 'Professional Experience', 'education': 'Education', 'certifications': 'Certifications', 'projects': 'Projects', 'skills': 'Skills', 'custom': 'Additional Information'}
ALIASES = {'summary': 'summary', 'professional summary': 'summary', 'profile': 'summary', 'objective': 'summary', 'experience': 'professional_experience', 'work experience': 'professional_experience', 'professional experience': 'professional_experience', 'employment': 'professional_experience', 'education': 'education', 'academic background': 'education', 'certifications': 'certifications', 'certificates': 'certifications', 'licenses': 'certifications', 'projects': 'projects', 'personal projects': 'projects', 'skills': 'skills', 'technical skills': 'skills', 'core competencies': 'skills'}
CONTACT_RE = re.compile(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}|linkedin\.com/', re.I)
CONTACT_HEADINGS = {'contact', 'contact information', 'personal information', 'contact info', 'contact details', 'personal details', 'personal info', 'contacts'}
DATE_RE = re.compile(r'\b(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b', re.I)


class ResumeBullet(BaseModel):
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)
    id: ResumeId
    text: str = Field(min_length=1, max_length=10000)
    source_ids: list[ResumeId] = Field(default_factory=list, max_length=100)


class ResumeEntry(BaseModel):
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)
    id: ResumeId
    fields: dict[str, str] = Field(default_factory=dict)
    bullets: list[ResumeBullet] = Field(default_factory=list, max_length=200)

    @model_validator(mode='after')
    def bounded_fields(self):
        if len(self.fields) > 30 or any(len(k) > 100 or len(v) > 10000 for k, v in self.fields.items()):
            raise ValueError('Entry fields exceed the resume document limit.')
        if any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_ -]*', key) for key in self.fields):
            raise ValueError('Entry field names must be plain labels.')
        return self


class ResumeSection(BaseModel):
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)
    id: ResumeId
    kind: SectionKind
    heading: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    review_state: Literal['reviewed', 'needs_review'] = 'needs_review'
    confidence: float | None = Field(default=None, ge=0, le=1)
    content_md: str = Field(default='', max_length=100000)
    source_ids: list[ResumeId] = Field(default_factory=list, max_length=500)
    entries: list[ResumeEntry] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def safe_heading(self):
        if '\n' in self.heading or '\r' in self.heading or self.heading.strip().lower() in CONTACT_HEADINGS:
            raise ValueError('Contact information is managed in the profile.')
        return self


class ResumeDocument(BaseModel):
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)
    schema_version: Literal[1] = 1
    revision: int = Field(default=1, ge=1)
    sections: list[ResumeSection] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def unique_ids(self):
        identifiers = []
        for section in self.sections:
            identifiers.append(section.id)
            for entry in section.entries:
                identifiers.append(entry.id)
                identifiers.extend(bullet.id for bullet in entry.bullets)
        if len(identifiers) != len(set(identifiers)):
            raise ValueError('Resume section, entry and bullet IDs must be unique.')
        if sum(len(section.content_md) + sum(sum(map(len, entry.fields.values())) + sum(len(b.text) for b in entry.bullets) for entry in section.entries) for section in self.sections) > 500000:
            raise ValueError('Resume document exceeds the content limit.')
        return self


def validate_resume_document(payload: Any) -> ResumeDocument:
    return ResumeDocument.model_validate(payload)


def _clean(value: str) -> str:
    return re.sub(r'^[#*\s]+|[*\s]+$', '', value).strip()


def _entries(body: str, kind: str, previous: list[ResumeEntry], seed: str) -> list[ResumeEntry]:
    if kind not in {'professional_experience', 'education'}:
        return []
    blocks = re.split(r'\n\s*\n|(?=^###\s)', body.strip(), flags=re.M)
    result = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        headers = []
        bullets = []
        for line in lines:
            match = re.match(r'^[-*+]\s+(.+)', line)
            if match:
                bullets.append(match.group(1))
            elif bullets:
                bullets[-1] += '\n' + line
            else:
                headers.append(_clean(line))
        # Ambiguous imports stay in content_md for review; no guessed facts.
        if len(headers) == 1:
            parts = [part.strip() for part in headers[0].split('|')]
            if len(parts) != 3 or not DATE_RE.search(parts[-1]):
                return []
            if kind == 'professional_experience':
                fields = dict(title=parts[0], company=parts[1], location='', date_range=parts[2])
            else:
                fields = dict(qualification=parts[0], institution=parts[1], location='', date_range=parts[2])
        elif len(headers) == 2:
            first = [part.strip() for part in headers[0].split('|')]
            second = [part.strip() for part in headers[1].split('|')]
            if len(first) > 2 or len(second) > 2:
                return []
            if len(first) == 2 and DATE_RE.search(first[1]):
                first, second = second, first
            if len(second) != 2 or not DATE_RE.search(second[1]):
                return []
            if kind == 'professional_experience':
                fields = dict(company=first[0], location=first[1] if len(first) > 1 else '', title=second[0], date_range=second[1])
            else:
                fields = dict(institution=first[0], location=first[1] if len(first) > 1 else '', qualification=second[0], date_range=second[1])
        else:
            return []
        fact_key = 'company' if kind == 'professional_experience' else 'institution'
        used_entry_ids = {entry.id for entry in result}
        old = next((e for e in previous if e.id not in used_entry_ids and e.fields.get(fact_key) == fields.get(fact_key) and e.fields.get('date_range') == fields.get('date_range') and e.fields.get('title', e.fields.get('qualification')) == fields.get('title', fields.get('qualification'))), None)
        entry_id = old.id if old else uuid5(NAMESPACE_URL, seed + ':entry:' + str(len(result))).hex
        reserved = {entry.id for entry in previous} | used_entry_ids
        if old is None:
            suffix = 0
            while entry_id in reserved:
                suffix += 1
                entry_id = uuid5(NAMESPACE_URL, seed + ':entry:' + str(len(result)) + ':new:' + str(suffix)).hex
        parsed_bullets = []
        for index, text in enumerate(bullets):
            used = {bullet.id for bullet in parsed_bullets}
            prior = next((b for b in (old.bullets if old else []) if b.id not in used and b.text == text), None)
            if prior is None and old and index < len(old.bullets) and old.bullets[index].id not in used and old.bullets[index].text not in bullets[index + 1:]:
                prior = old.bullets[index]
            identifier = prior.id if prior else uuid5(NAMESPACE_URL, entry_id + ':bullet:' + str(index)).hex
            if prior is None:
                reserved_bullets = {bullet.id for bullet in (old.bullets if old else [])} | used
                suffix = 0
                while identifier in reserved_bullets:
                    suffix += 1
                    identifier = uuid5(NAMESPACE_URL, entry_id + ':bullet:' + str(index) + ':new:' + str(suffix)).hex
            parsed_bullets.append(ResumeBullet(id=identifier, text=text, source_ids=prior.source_ids if prior else []))
        result.append(ResumeEntry(id=entry_id, fields=fields, bullets=parsed_bullets))
    return result


def parse_resume_document(content_md: str, reviewed: bool = False, previous: Any = None) -> ResumeDocument:
    """Lossless local section adapter for legacy Markdown and manual entry.

    Ambiguous entry text remains editable Markdown and must be reviewed. A
    classifier/extractor can enrich it without replacing the original source.
    """
    old = validate_resume_document(previous) if previous is not None else None
    pairs: list[tuple[str, list[str]]] = []
    heading = None
    body: list[str] = []
    preamble = []
    for line in content_md.splitlines():
        match = re.match(r'^##\s+(.+?)\s*$', line.strip())
        if match:
            if heading is not None:
                pairs.append((heading, body))
            heading, body = match.group(1), []
        elif heading is None:
            # Top heading and contact stay out of the source body.
            if line.strip() and not line.startswith('# ') and not CONTACT_RE.search(line):
                preamble.append(line)
        else:
            body.append(line)
    if heading is not None:
        pairs.append((heading, body))
    if preamble:
        pairs.insert(0, ('Additional Information', preamble))
    sections = []
    used = set()
    for label, lines in pairs:
        if label.strip().lower() in CONTACT_HEADINGS:
            continue
        kind = ALIASES.get(label.strip().lower(), 'custom')
        prior = next((s for s in (old.sections if old else []) if s.id not in used and s.heading.casefold() == label.casefold()), None)
        if prior:
            used.add(prior.id)
        text = '\n'.join(lines).strip()
        identifier = prior.id if prior else uuid5(NAMESPACE_URL, 'resume-section:' + label.casefold() + ':' + str(sum(1 for s in sections if s.heading.casefold() == label.casefold()))).hex
        reserved = {section.id for section in (old.sections if old else [])} | {section.id for section in sections}
        if prior is None:
            suffix = 0
            while identifier in reserved:
                suffix += 1
                identifier = uuid5(NAMESPACE_URL, 'resume-section:' + label.casefold() + ':new:' + str(suffix)).hex
        entries = _entries(text, kind, prior.entries if prior else [], identifier)
        sections.append(ResumeSection(id=identifier, kind=kind, heading=label, enabled=prior.enabled if prior else True, review_state='reviewed' if reviewed else 'needs_review', confidence=None, content_md=text, entries=entries))
    return ResumeDocument(revision=old.revision if old else 1, sections=sections)


def render_section_content(section: ResumeSection) -> str:
    if not section.entries:
        return section.content_md.strip()
    blocks = []
    for entry in section.entries:
        row_fields = {'company', 'title', 'location', 'date_range', 'institution', 'qualification', 'name', 'issuer', 'date', 'url'}
        facts = {key: re.sub(r'\s+', ' ', value).strip() if key in row_fields else value for key, value in entry.fields.items()}
        if section.kind == 'professional_experience':
            first, second = facts.get('company', ''), facts.get('title', '')
        elif section.kind == 'education':
            first, second = facts.get('institution', ''), facts.get('qualification', '')
        else:
            first, second = facts.get('name', facts.get('text', '')), facts.get('details', '')
        if section.kind in {'professional_experience', 'education'}:
            lines = [first + (' | ' + facts['location'] if facts.get('location') else ''), second + (' | ' + facts['date_range'] if facts.get('date_range') else '')]
        else:
            lines = [' | '.join(v for v in [first, facts.get('issuer', ''), facts.get('date', ''), facts.get('url', '')] if v)]
            if second:
                lines.append(second)
        handled = {'company', 'title', 'location', 'date_range'} if section.kind == 'professional_experience' else {'institution', 'qualification', 'location', 'date_range'} if section.kind == 'education' else {'name', 'text', 'details', 'issuer', 'date', 'url'}
        lines.extend('- ' + key.replace('_', ' ').capitalize() + ': ' + value.replace('\n', '\n  ') for key, value in facts.items() if key not in handled and value.strip())
        lines.extend('- ' + bullet.text for bullet in entry.bullets)
        blocks.append('\n'.join(lines).strip())
    return '\n\n'.join(blocks)


def render_resume_document(document: Any, include_disabled: bool = False) -> str:
    parsed = validate_resume_document(document)
    return '\n\n'.join('## ' + section.heading + '\n' + render_section_content(section) for section in parsed.sections if (include_disabled or section.enabled) and render_section_content(section)).strip() + ('\n' if parsed.sections else '')


def document_ready(document: Any) -> bool:
    parsed = validate_resume_document(document)
    enabled = [s for s in parsed.sections if s.enabled and render_section_content(s)]
    for section in enabled:
        required = ('company', 'title') if section.kind == 'professional_experience' else ('institution', 'qualification') if section.kind == 'education' else ()
        if any(any(not entry.fields.get(key, '').strip() for key in required) for entry in section.entries):
            return False
    return bool(enabled) and all(s.review_state == 'reviewed' for s in enabled)
