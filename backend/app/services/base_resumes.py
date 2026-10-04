from __future__ import annotations

from html.parser import HTMLParser
from typing import Optional

import markdown

import psycopg
from fastapi import Depends
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.db.base_resumes import BaseResumeListRecord, BaseResumeRecord, BaseResumeRepository
from app.db.profiles import ProfileRepository
from app.services.resume_contacts import extract_contact_suggestions
from app.services.resume_privacy import sanitize_resume_markdown
from app.services.resume_document import (
    document_ready,
    parse_resume_document,
    render_resume_document,
    validate_resume_document,
)


def _render_source_document(document) -> str:
    """Keep disabled source sections recoverable in the Markdown projection."""
    projection = document.model_copy(deep=True)
    for section in projection.sections:
        section.enabled = True
    return render_resume_document(projection)


class ResumeWithDefaultFlag(BaseModel):
    summary: str = ""
    id: str
    name: str
    user_id: str
    created_at: str
    updated_at: str
    is_default: bool


class ResumeDetailWithDefaultFlag(BaseModel):
    id: str
    name: str
    user_id: str
    content_md: str
    document: dict
    revision: int = 1
    raw_source_md: Optional[str] = None
    needs_review: bool = False
    import_warning: Optional[str] = None
    ready_for_generation: bool = False
    contact_suggestions: dict[str, str] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    is_default: bool


class _SummaryText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"p", "li", "div", "h1", "h2", "h3"}:
            self.parts.append(" ")

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "br":
            self.parts.append(" ")


def _summary_excerpt(record: BaseResumeListRecord) -> str:
    source = record.summary_md
    if record.legacy_content_md:
        document = parse_resume_document(record.legacy_content_md)
        source = next((section.content_md for section in document.sections
                       if section.kind == "summary" and section.content_md.strip()), "")
    parser = _SummaryText()
    parser.feed(markdown.markdown(source))
    text = " ".join("".join(parser.parts).split())
    return text if len(text) <= 240 else text[:237].rsplit(" ", 1)[0] + "…"


class BaseResumeService:
    def __init__(
        self,
        repo: BaseResumeRepository,
        profile_repo: ProfileRepository,
    ) -> None:
        self.repo = repo
        self.profile_repo = profile_repo

    def _is_default(self, user_id: str, resume_id: str) -> bool:
        default_id = self.profile_repo.fetch_default_resume_id(user_id)
        return default_id == resume_id

    def _detail(self, record: BaseResumeRecord) -> ResumeDetailWithDefaultFlag:
        document = (
            validate_resume_document(record.document)
            if record.document is not None
            else parse_resume_document(sanitize_resume_markdown(record.content_md).sanitized_markdown, reviewed=False)
        )
        document.revision = record.revision
        serialized = document.model_dump(mode="json")
        return ResumeDetailWithDefaultFlag(
            **{
                **record.model_dump(),
                "document": serialized,
                "contact_suggestions": record.contact_suggestions or extract_contact_suggestions(record.raw_source_md or record.content_md),
                "needs_review": any(section.review_state == "needs_review" for section in document.sections),
                "ready_for_generation": document_ready(document),
            },
            is_default=self._is_default(record.user_id, record.id),
        )

    def list_resumes(self, user_id: str) -> list[ResumeWithDefaultFlag]:
        records = self.repo.list_resumes(user_id)
        return [
            ResumeWithDefaultFlag(
                **record.model_dump(),
                summary=_summary_excerpt(record),
                is_default=self._is_default(user_id, record.id),
            )
            for record in records
        ]

    def create_resume(
        self,
        user_id: str,
        name: str,
        content_md: str,
        document: Optional[dict] = None,
        raw_source_md: Optional[str] = None,
        import_warning: Optional[str] = None,
        contact_suggestions: Optional[dict[str, str]] = None,
    ) -> ResumeDetailWithDefaultFlag:
        stripped_name = name.strip()
        if not stripped_name:
            raise ValueError("Resume name cannot be blank.")

        parsed = validate_resume_document(document) if document is not None else parse_resume_document(sanitize_resume_markdown(content_md).sanitized_markdown, reviewed=False)
        parsed.revision = 1
        rendered = _render_source_document(parsed)
        if not rendered.strip():
            raise ValueError("Resume must contain at least one section with content.")
        record = self.repo.create_resume(
            user_id=user_id,
            name=stripped_name,
            content_md=rendered,
            document=parsed.model_dump(mode="json"),
            raw_source_md=raw_source_md if raw_source_md is not None else content_md or None,
            import_warning=import_warning,
            contact_suggestions=contact_suggestions if contact_suggestions is not None else extract_contact_suggestions(raw_source_md or content_md),
        )
        return self._detail(record)

    def get_resume(self, user_id: str, resume_id: str) -> ResumeDetailWithDefaultFlag:
        record = self.repo.fetch_resume(user_id, resume_id)
        if record is None:
            raise LookupError("Base resume not found.")
        return self._detail(record)

    def update_resume(
        self,
        user_id: str,
        resume_id: str,
        updates: dict,
    ) -> ResumeDetailWithDefaultFlag:
        # Verify ownership by fetching first
        existing = self.repo.fetch_resume(user_id, resume_id)
        if existing is None:
            raise LookupError("Base resume not found.")

        updates = dict(updates)
        expected_revision = updates.pop("expected_revision", None)
        if expected_revision is not None and expected_revision != existing.revision:
            raise PermissionError("This resume changed while you were editing. Reload it before saving.")
        # Validate name if provided
        if "name" in updates:
            if not isinstance(updates["name"], str):
                raise ValueError("Resume name cannot be blank.")
            stripped_name = updates["name"].strip()
            if not stripped_name:
                raise ValueError("Resume name cannot be blank.")
            updates["name"] = stripped_name
        existing_document = self._detail(existing).document
        if "document" in updates:
            if updates["document"] is None:
                raise ValueError("Resume document cannot be null.")
            document = validate_resume_document(updates["document"])
            if expected_revision is None:
                expected_revision = document.revision
                if expected_revision != existing.revision:
                    raise PermissionError("This resume changed while you were editing. Reload it before saving.")
            document.revision = existing.revision + 1
            updates["document"] = document.model_dump(mode="json")
            updates["content_md"] = _render_source_document(document)
        elif "content_md" in updates:
            if updates["content_md"] is None:
                raise ValueError("Resume content cannot be null.")
            raw_markdown = updates["content_md"]
            document = parse_resume_document(sanitize_resume_markdown(raw_markdown).sanitized_markdown, reviewed=False, previous=existing_document)
            updates["raw_source_md"] = raw_markdown
            new_contact = extract_contact_suggestions(raw_markdown)
            if new_contact:
                updates["contact_suggestions"] = new_contact
            document.revision = existing.revision + 1
            updates["document"] = document.model_dump(mode="json")
            updates["content_md"] = _render_source_document(document)
        else:
            document = validate_resume_document(existing_document)
            document.revision = existing.revision + 1
            updates["document"] = document.model_dump(mode="json")
        if not updates.get("content_md", existing.content_md).strip():
            raise ValueError("Resume must contain at least one section with content.")
        if "document" in updates and document_ready(document):
            updates["import_warning"] = None
        # Always fence the write, including legacy Markdown and rename requests.
        record = self.repo.update_resume(resume_id, user_id, updates, expected_revision=expected_revision or existing.revision)
        return self._detail(record)

    def delete_resume(
        self,
        user_id: str,
        resume_id: str,
        force: bool = False,
    ) -> None:
        # Verify ownership
        existing = self.repo.fetch_resume(user_id, resume_id)
        if existing is None:
            raise LookupError("Base resume not found.")

        # Check if referenced by any applications
        if self.repo.is_referenced(resume_id, user_id):
            if not force:
                raise ValueError(
                    "This resume is referenced by one or more applications. "
                    "Use force=true to delete anyway."
                )

        try:
            deleted = self.repo.delete_resume(resume_id, user_id)
        except psycopg.errors.ForeignKeyViolation as error:
            raise PermissionError(
                "This resume cannot be deleted because related records still reference it."
            ) from error

        if not deleted:
            raise LookupError("Base resume not found.")

    def set_default(self, user_id: str, resume_id: str) -> ResumeWithDefaultFlag:
        # Verify resume exists and belongs to user
        record = self.repo.fetch_resume(user_id, resume_id)
        if record is None:
            raise LookupError("Base resume not found.")

        # Update profile's default_base_resume_id
        self.profile_repo.update_default_resume(user_id, resume_id)

        return ResumeWithDefaultFlag(
            **record.model_dump(),
            is_default=True,
        )


def get_base_resume_service(
    settings: Settings = Depends(get_settings),
) -> BaseResumeService:
    from app.db.base_resumes import get_base_resume_repository
    from app.db.profiles import get_profile_repository

    return BaseResumeService(
        repo=get_base_resume_repository(),
        profile_repo=get_profile_repository(),
    )
