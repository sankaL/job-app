from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
import re
from dataclasses import dataclass
from time import monotonic
from typing import Optional

import jwt
from fastapi import Request
from redis.asyncio import Redis
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)


RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""

EXPENSIVE_APPLICATION_PATH = re.compile(
    r"^/api/applications/[^/]+/(generate|regenerate|regenerate-section|judge|optimize-keywords|export-pdf|export-docx)$"
)


@dataclass(frozen=True)
class RateLimitRule:
    name: str
    limit: int
    window_seconds: int


GLOBAL_RULE = RateLimitRule("global", 600, 60)
DEFAULT_API_RULE = RateLimitRule("api", 240, 60)
NETWORK_SCOPED_RULES = {
    "auth-login",
    "auth-refresh",
    "invite-preview",
    "invite-accept",
    "access-request",
    "worker-callback",
    "extension-import",
}


def classify_rate_limit(method: str, path: str) -> RateLimitRule:
    normalized_method = method.upper()
    if path == "/api/auth/login" and normalized_method == "POST":
        return RateLimitRule("auth-login", 5, 60)
    if path == "/api/auth/refresh" and normalized_method == "POST":
        return RateLimitRule("auth-refresh", 20, 60)
    if path == "/api/public/invites/preview" and normalized_method == "GET":
        return RateLimitRule("invite-preview", 30, 300)
    if path == "/api/public/invites/accept" and normalized_method == "POST":
        return RateLimitRule("invite-accept", 8, 600)
    if path == "/api/public/access-requests" and normalized_method == "POST":
        return RateLimitRule("access-request", 5, 600)
    if path.startswith("/api/internal/worker/") and normalized_method == "POST":
        return RateLimitRule("worker-callback", 240, 60)
    if path == "/api/extension/import" and normalized_method == "POST":
        return RateLimitRule("extension-import", 30, 60)
    if path == "/api/base-resumes/upload" and normalized_method == "POST":
        return RateLimitRule("resume-upload", 10, 600)
    if EXPENSIVE_APPLICATION_PATH.fullmatch(path) and normalized_method in {"GET", "POST"}:
        return RateLimitRule("expensive-application-operation", 20, 60)
    return DEFAULT_API_RULE


def _valid_ip(value: str) -> Optional[str]:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def client_network_identity(request: Request, *, trusted_proxy_hops: int) -> str:
    direct_ip = _valid_ip(request.client.host) if request.client else None
    forwarded = request.headers.get("x-forwarded-for", "")
    forwarded_ips = [valid for item in forwarded.split(",") if (valid := _valid_ip(item))]
    if trusted_proxy_hops > 0 and len(forwarded_ips) >= trusted_proxy_hops:
        return f"ip:{forwarded_ips[-trusted_proxy_hops]}"
    return f"ip:{direct_ip or 'unknown'}"


def _bearer_subject(authorization: str, *, public_key: str) -> Optional[str]:
    if not authorization.startswith("Bearer ") or len(authorization) > 8192:
        return None
    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            issuer="resume-builder",
        )
    except jwt.PyJWTError:
        return None
    subject = claims.get("sub")
    return subject if isinstance(subject, str) and subject else None


def request_credential_identity(
    request: Request,
    network_identity: str,
    *,
    public_key: str,
) -> str:
    subject = _bearer_subject(
        request.headers.get("authorization", ""),
        public_key=public_key,
    )
    if subject:
        return f"user:{subject}"

    for header, prefix in (
        ("x-extension-token", "extension"),
        ("x-worker-secret", "worker"),
    ):
        value = request.headers.get(header, "")
        if value:
            digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
            return f"{prefix}:{digest}"
    return network_identity


class RedisRateLimiter:
    def __init__(self, redis_url: str, *, operation_timeout_seconds: float = 0.5) -> None:
        self._redis = Redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=operation_timeout_seconds,
            socket_timeout=operation_timeout_seconds,
        )
        self._operation_timeout_seconds = operation_timeout_seconds

    async def check(self, *, rule: RateLimitRule, identity: str) -> tuple[bool, int, int]:
        identity_digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        key = f"rate-limit:v1:{rule.name}:{identity_digest}"
        result = await asyncio.wait_for(
            self._redis.eval(RATE_LIMIT_SCRIPT, 1, key, rule.window_seconds),
            timeout=self._operation_timeout_seconds,
        )
        count = int(result[0])
        retry_after = max(int(result[1]), 1)
        return count <= rule.limit, max(rule.limit - count, 0), retry_after

    async def aclose(self) -> None:
        await self._redis.aclose()


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        limiter: RedisRateLimiter,
        enabled: bool,
        fail_closed: bool,
        trusted_proxy_hops: int,
        jwt_public_key: str,
    ) -> None:
        super().__init__(app)
        self._limiter = limiter
        self._enabled = enabled
        self._fail_closed = fail_closed
        self._trusted_proxy_hops = trusted_proxy_hops
        self._jwt_public_key = jwt_public_key
        self._last_storage_error_log_at = 0.0

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if (
            not self._enabled
            or request.method == "OPTIONS"
            or request.url.path == "/healthz"
            or not request.url.path.startswith("/api/")
        ):
            return await call_next(request)

        network_identity = client_network_identity(
            request,
            trusted_proxy_hops=self._trusted_proxy_hops,
        )
        endpoint_rule = classify_rate_limit(request.method, request.url.path)
        endpoint_identity = network_identity
        if endpoint_rule.name not in NETWORK_SCOPED_RULES:
            endpoint_identity = request_credential_identity(
                request,
                network_identity,
                public_key=self._jwt_public_key,
            )

        try:
            global_allowed, _, global_retry = await self._limiter.check(
                rule=GLOBAL_RULE,
                identity=network_identity,
            )
            endpoint_allowed, remaining, endpoint_retry = await self._limiter.check(
                rule=endpoint_rule,
                identity=endpoint_identity,
            )
        except Exception:
            now = monotonic()
            if now - self._last_storage_error_log_at >= 60:
                # Redis exceptions can include connection URLs. Keep the
                # operational signal without risking credential disclosure.
                logger.warning("Rate-limit storage is unavailable.")
                self._last_storage_error_log_at = now
            if self._fail_closed:
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Request throttling is temporarily unavailable."},
                    headers={"Retry-After": "1"},
                )
            return await call_next(request)

        if not global_allowed or not endpoint_allowed:
            retry_after = max(
                global_retry if not global_allowed else 0,
                endpoint_retry if not endpoint_allowed else 0,
            )
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": str(retry_after)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(endpoint_rule.limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
