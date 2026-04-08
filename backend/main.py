"""
Agentic HRMS - Main FastAPI Application
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from backend.core.config import settings
from backend.database.session import engine, Base

from backend.api.face_auth import router as face_auth_router
from backend.api.pin_auth import router as pin_auth_router
from backend.api.registration import router as registration_router   # ← ADDED

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def run_migrations():
    try:
        from alembic.config import Config
        from alembic import command
        alembic_cfg = Config("alembic.ini")
        command.upgrade(alembic_cfg, "head")
        logger.info("✅ Migrations done")
    except Exception as e:
        logger.warning(f"⚠️ Migration skipped: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting...")
    run_migrations()
    logger.info("✅ Application startup complete")
    yield
    logger.info("👋 Shutting down...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── IMPORTANT: Use prefix="/api" to match frontend calls ──────────────────────
# All auth routes will be: /api/auth/...
API_PREFIX = "/api"

app.include_router(face_auth_router, prefix=API_PREFIX)
app.include_router(pin_auth_router,  prefix=API_PREFIX)
app.include_router(registration_router, prefix=API_PREFIX)   # ← ADDED


@app.get("/")
async def root():
    return {"message": "Agentic HRMS API", "version": settings.VERSION}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/debug/face")
async def debug_face():
    try:
        import joblib, numpy as np, sklearn
        clf = joblib.load("data/face_models/face_classifier.pkl")
        labels = np.load("data/face_models/labels.npy", allow_pickle=True)
        return {
            "sklearn_version": sklearn.__version__,
            "classifier": str(type(clf).__name__),
            "n_samples": int(len(clf._fit_X)),
            "unique_labels": sorted(set(str(l) for l in labels))
        }
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=settings.RELOAD)