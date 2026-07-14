from __future__ import annotations

import socket
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.http_security import RequestBodyLimitMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import (
    RateLimitMiddleware,
    RateLimitRule,
    classify_rate_limit,
    client_network_identity,
)
from app.db.connection import rls_connection
from app.services.url_security import OutboundResolutionUnavailable, validate_public_http_url

ROOT = Path(__file__).resolve().parents[2]


class FakeLimiter:
    def __init__(self, *, endpoint_allowed: bool = True, fail: bool = False) -> None:
        self.endpoint_allowed = endpoint_allowed
        self.fail = fail
        self.calls: list[tuple[str, str]] = []

    async def check(self, *, rule: RateLimitRule, identity: str):
        self.calls.append((rule.name, identity))
        if self.fail:
            raise ConnectionError("redis unavailable")
        if rule.name == "global":
            return True, rule.limit - 1, 1
        return self.endpoint_allowed, max(rule.limit - 1, 0), 37


def build_rate_limited_app(limiter: FakeLimiter) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        limiter=limiter,
        enabled=True,
        fail_closed=True,
        trusted_proxy_hops=0,
        jwt_public_key="unused-for-requests-without-valid-bearer-tokens",
    )

    @app.get("/api/test")
    def endpoint():
        return {"ok": True}

    return app


def test_sensitive_routes_have_stricter_rate_limit_buckets():
    assert classify_rate_limit("POST", "/api/auth/login").limit == 5
    assert classify_rate_limit("POST", "/api/public/invites/accept").window_seconds == 600
    assert classify_rate_limit("POST", "/api/applications/a/generate").name == (
        "expensive-application-operation"
    )


def test_proxy_identity_uses_rightmost_trusted_client_hop():
    app = FastAPI()

    @app.get("/")
    def endpoint(request: Request):
        return {"identity": client_network_identity(request, trusted_proxy_hops=1)}

    client = TestClient(app)
    response = client.get("/", headers={"x-forwarded-for": "198.51.100.3, 203.0.113.7"})
    assert response.json()["identity"] == "ip:203.0.113.7"


def test_rate_limit_returns_retry_after_when_exhausted():
    response = TestClient(build_rate_limited_app(FakeLimiter(endpoint_allowed=False))).get(
        "/api/test"
    )
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "37"


def test_rate_limit_fails_closed_when_redis_is_unavailable():
    response = TestClient(build_rate_limited_app(FakeLimiter(fail=True))).get("/api/test")
    assert response.status_code == 503
    assert response.json()["detail"] == "Request throttling is temporarily unavailable."


def test_login_rate_limit_ignores_rotating_unverified_bearer_subjects():
    limiter = FakeLimiter()
    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        limiter=limiter,
        enabled=True,
        fail_closed=True,
        trusted_proxy_hops=0,
        jwt_public_key="not-used-for-network-scoped-login",
    )

    @app.post("/api/auth/login")
    def endpoint():
        return {"ok": True}

    client = TestClient(app)
    client.post("/api/auth/login", headers={"authorization": "Bearer forged-one"})
    client.post("/api/auth/login", headers={"authorization": "Bearer forged-two"})

    endpoint_identities = [
        identity for rule, identity in limiter.calls if rule == "auth-login"
    ]
    assert endpoint_identities == ["ip:unknown", "ip:unknown"]


def test_request_body_limit_rejects_before_route_parsing():
    app = FastAPI()
    app.add_middleware(RequestBodyLimitMiddleware, path_limits={"/api/upload": 8})

    @app.post("/api/upload")
    async def endpoint(request: Request):
        return {"length": len(await request.body())}

    client = TestClient(app)
    response = client.post("/api/upload", content=b"123456789")
    assert response.status_code == 413
    assert response.json()["detail"] == "Request body is too large."

    response = client.post("/api/upload", content=b"12345678")
    assert response.status_code == 200
    assert response.json() == {"length": 8}


def test_security_headers_are_set_for_api_responses():
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware, production=True)

    @app.get("/api/test")
    def endpoint():
        return {"ok": True}

    response = TestClient(app).get("/api/test")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Strict-Transport-Security"].startswith("max-age=")


@pytest.mark.asyncio
async def test_outbound_url_validation_rejects_private_and_mixed_dns_answers():
    with pytest.raises(ValueError, match="public network"):
        await validate_public_http_url("http://127.0.0.1/admin")

    def mixed_resolver(*_args, **_kwargs):
        return [
            (2, 1, 6, "", ("93.184.216.34", 443)),
            (2, 1, 6, "", ("10.0.0.5", 443)),
        ]

    with pytest.raises(ValueError, match="only to public"):
        await validate_public_http_url("https://jobs.example.test/opening", resolver=mixed_resolver)


@pytest.mark.asyncio
async def test_outbound_url_validation_allows_public_dns_answers():
    def public_resolver(*_args, **_kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 443))]

    await validate_public_http_url("https://jobs.example.test/opening", resolver=public_resolver)


@pytest.mark.asyncio
async def test_outbound_url_validation_distinguishes_transient_dns_failure():
    def temporary_failure(*_args, **_kwargs):
        raise socket.gaierror(socket.EAI_AGAIN, "temporary failure")

    with pytest.raises(OutboundResolutionUnavailable, match="temporarily unavailable"):
        await validate_public_http_url(
            "https://jobs.example.test/opening",
            resolver=temporary_failure,
        )


def test_database_connection_sets_role_and_exactly_one_rls_context(monkeypatch):
    statements: list[tuple[str, tuple | None]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, params=None):
            statements.append((statement, params))

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def cursor(self):
            return Cursor()

    monkeypatch.setattr("app.db.connection.psycopg.connect", lambda *_args, **_kwargs: Connection())

    with rls_connection("postgresql://unused", user_id="user-1"):
        pass

    assert statements[0][0] == "set local role app_runtime"
    assert statements[1][1] == ("user-1",)
    assert statements[2][1] == ("false",)

    with pytest.raises(ValueError, match="Exactly one"):
        with rls_connection("postgresql://unused"):
            pass
    with pytest.raises(ValueError, match="Exactly one"):
        with rls_connection("postgresql://unused", user_id="user-1", service=True):
            pass


def test_rls_migration_enables_and_forces_all_application_tables():
    migration = (
        ROOT / "supabase/migrations/20260714_000018_enable_row_level_security.sql"
    ).read_text(encoding="utf-8")
    tables = {
        "users",
        "refresh_tokens",
        "profiles",
        "base_resumes",
        "applications",
        "resume_drafts",
        "notifications",
        "user_invites",
        "usage_events",
        "resume_generation_usage",
        "subscription_tiers",
    }
    for table in tables:
        assert f"alter table public.{table} enable row level security" in migration
        assert f"alter table public.{table} force row level security" in migration
    assert "disable row level security" not in migration
    assert "nobypassrls" in migration
