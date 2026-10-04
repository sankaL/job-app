"""Verify fencing against the actual Redis used by the local Makefile stack."""
import json
import os
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from app.core.config import get_settings
from app.services.progress import RedisProgressStore, build_progress


@pytest.mark.asyncio
async def test_progress_compare_and_set_uses_decoded_job_snapshot_and_expiry():
    redis_url = get_settings().redis_url
    if os.environ.get('APP_DEV_MODE') != 'true' or urlparse(redis_url).hostname not in {'redis', 'localhost', '127.0.0.1'}:
        pytest.skip('Requires the Makefile-managed local Redis.')
    store = RedisProgressStore(redis_url)
    application_id = 'test-cas-' + uuid4().hex
    observed = build_progress(job_id='old', state='extracting', message='Running', percent_complete=65)
    terminal = build_progress(job_id='stopped', state='manual_entry_required', message='Stopped', percent_complete=100,
        completed_at=observed.updated_at, terminal_error_code='extraction_failed')
    try:
        # Worker dataclass JSON uses different whitespace and omits some optional keys.
        payload = observed.model_dump()
        payload.pop('quota_period_start')
        await store._redis.set(store._key(application_id), json.dumps(payload, indent=2))
        assert await store.replace_if_unchanged(application_id, expected=observed, replacement=terminal)
        assert (await store.get(application_id)).job_id == 'stopped'
        assert 0 < await store._redis.ttl(store._key(application_id)) <= 86400
        assert not await store.replace_if_unchanged(application_id, expected=observed, replacement=terminal)
        assert not await store.replace_if_unchanged(application_id, expected=None, replacement=terminal)
        fresh = observed.model_copy(update={'updated_at': '2026-10-04T12:00:00+00:00'})
        await store._redis.set(store._key(application_id), fresh.model_dump_json())
        assert not await store.replace_if_unchanged(application_id, expected=observed, replacement=terminal)
        await store.delete(application_id)
        assert not await store.replace_if_unchanged(application_id, expected=observed, replacement=terminal)
        assert await store.replace_if_unchanged(application_id, expected=None, replacement=terminal)
    finally:
        await store.delete(application_id)
        await store._redis.aclose()
