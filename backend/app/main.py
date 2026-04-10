from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.applications import router as applications_router
from app.api.admin import router as admin_router
from app.api.base_resumes import router as base_resumes_router
from app.api.extension import router as extension_router
from app.api.internal_worker import router as internal_worker_router
from app.api.notifications import router as notifications_router
from app.api.profiles import router as profiles_router
from app.api.public_invites import router as public_invites_router
from app.api.session import router as session_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="Applix API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(session_router)
app.include_router(profiles_router)
app.include_router(applications_router)
app.include_router(notifications_router)
app.include_router(base_resumes_router)
app.include_router(extension_router)
app.include_router(admin_router)
app.include_router(public_invites_router)
app.include_router(internal_worker_router)
