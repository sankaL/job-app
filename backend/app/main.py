from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.access_requests import router as access_requests_router
from app.api.applications import router as applications_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.base_resumes import router as base_resumes_router
from app.api.extension import router as extension_router
from app.api.internal_worker import router as internal_worker_router
from app.api.notifications import router as notifications_router
from app.api.profiles import router as profiles_router
from app.api.public_invites import router as public_invites_router
from app.api.session import router as session_router
from app.core.config import get_settings
from app.core.http_security import RequestBodyLimitMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import RateLimitMiddleware, RedisRateLimiter

settings = get_settings()
rate_limiter = RedisRateLimiter(settings.redis_url)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await rate_limiter.aclose()

app = FastAPI(
    title="Applix API",
    version="0.1.0",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    openapi_url="/openapi.json" if settings.is_development else None,
    lifespan=lifespan,
)
app.add_middleware(
    RateLimitMiddleware,
    limiter=rate_limiter,
    enabled=settings.rate_limit_enabled,
    fail_closed=settings.rate_limit_fail_closed,
    trusted_proxy_hops=settings.trusted_proxy_hops,
    jwt_public_key=settings.jwt_public_key,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list + settings.chrome_extension_origin_list,
    allow_origin_regex=r"chrome-extension://[a-p]{32}" if settings.is_local_dev_mode else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Accept",
        "Authorization",
        "Content-Type",
        "Last-Event-ID",
        "X-Extension-Token",
        "X-Worker-Secret",
    ],
    expose_headers=[
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
    ],
)
app.add_middleware(
    RequestBodyLimitMiddleware,
    path_limits={"/api/base-resumes/upload": 11 * 1024 * 1024},
)
app.add_middleware(SecurityHeadersMiddleware, production=not settings.is_development)


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(session_router)
app.include_router(profiles_router)
app.include_router(applications_router)
app.include_router(notifications_router)
app.include_router(base_resumes_router)
app.include_router(extension_router)
app.include_router(admin_router)
app.include_router(public_invites_router)
app.include_router(access_requests_router)
app.include_router(internal_worker_router)
