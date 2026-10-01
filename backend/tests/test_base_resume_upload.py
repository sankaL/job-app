from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.base_resumes import get_resume_parser, router
from app.core.access import get_current_active_user
from app.services.base_resumes import get_base_resume_service
from app.services.resume_parser import ResumeImportResult


@pytest.mark.parametrize('flag, expected', [(None, True), ('true', True), ('false', False)])
def test_upload_defaults_to_ai_entry_extraction_and_preserves_explicit_opt_out(monkeypatch, flag, expected):
    captured = {}
    document = {'schema_version': 1, 'revision': 1, 'sections': [
        {'id': 'experience', 'kind': 'professional_experience', 'heading': 'Experience',
         'content_md': 'Acme\nEngineer', 'review_state': 'needs_review', 'entries': []}
    ]}

    class Parser:
        async def import_resume(self, source, *, use_llm_cleanup):
            captured.update(source=source, use_ai=use_llm_cleanup)
            return ResumeImportResult(document=document)

    class Service:
        def create_resume(self, **kwargs):
            captured.update(user_id=kwargs['user_id'], saved_source=kwargs['raw_source_md'])
            payload = {
                'id': 'source', 'name': kwargs['name'], 'content_md': kwargs['content_md'],
                'document': kwargs['document'], 'revision': 1, 'is_default': False,
                'created_at': '2026-09-30', 'updated_at': '2026-09-30',
            }
            return SimpleNamespace(model_dump=lambda: payload)

    monkeypatch.setattr('app.api.base_resumes.parse_pdf_with_timeout', lambda _: '## Experience\nAcme\nEngineer')
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_active_user] = lambda: SimpleNamespace(id='owner')
    app.dependency_overrides[get_resume_parser] = Parser
    app.dependency_overrides[get_base_resume_service] = Service
    data = {'name': 'Imported resume'}
    if flag is not None:
        data['use_llm_cleanup'] = flag
    with TestClient(app) as client:
        response = client.post('/api/base-resumes/upload', data=data, files={'file': ('resume.pdf', b'%PDF-1.7\nsynthetic', 'application/pdf')})
    assert response.status_code == 201
    assert captured == {'source': '## Experience\nAcme\nEngineer', 'use_ai': expected, 'user_id': 'owner', 'saved_source': '## Experience\nAcme\nEngineer'}
    assert response.json()['needs_review'] is True
