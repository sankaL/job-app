from __future__ import annotations

import pytest

from url_security import validate_public_http_url


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/admin",
        "http://127.0.0.1/admin",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/admin",
        "ftp://example.com/file",
        "https://user:password@example.com/job",
    ],
)
async def test_validate_public_http_url_rejects_non_public_targets(url: str):
    with pytest.raises(ValueError):
        await validate_public_http_url(url)


@pytest.mark.asyncio
async def test_validate_public_http_url_rejects_dns_rebinding_candidates():
    def mixed_resolver(*_args, **_kwargs):
        return [
            (2, 1, 6, "", ("93.184.216.34", 443)),
            (2, 1, 6, "", ("192.168.1.20", 443)),
        ]

    with pytest.raises(ValueError, match="only to public"):
        await validate_public_http_url("https://jobs.example.test/opening", resolver=mixed_resolver)


@pytest.mark.asyncio
async def test_validate_public_http_url_allows_public_targets():
    def public_resolver(*_args, **_kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 443))]

    await validate_public_http_url("https://jobs.example.test/opening", resolver=public_resolver)
