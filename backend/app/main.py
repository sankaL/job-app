from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.session import router as session_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="AI Resume Builder API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(session_router)
