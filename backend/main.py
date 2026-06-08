"""
Agentic HRMS - Main FastAPI Application
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from backend.core.config import settings

from backend.api.face_auth import router as face_auth_router
from backend.api.pin_auth import router as pin_auth_router
from backend.api.registration import router as registration_router 
from backend.api.onboarding import router as onboarding_router
from backend.api.onboarding_router import router as onboarding_profile_router
from backend.api.chat import router as chat_router
from backend.api.docs import router as docs_router   # ✅ ADDED
from backend.api.meetings import router as meetings_router
from backend.api.leave_router import router as leaves_router
from backend.api.notifications import router as notifications_router
from backend.api.admin import router as admin_router
from backend.api.email_settings import router as email_settings_router
try:
    from backend.api.approval_router import router as approval_requests_router
    _has_approvals = True
except ImportError:
    approval_requests_router = None
    _has_approvals = False


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # NOTE: Database migrations are intentionally NOT run here. They are an
    # explicit deploy step: `alembic upgrade head` before/at deploy time.
    # Running migrations at app startup hid failures behind a warning and let
    # a broken schema boot silently. (Re-removed after merging Suraj's branch,
    # which had reintroduced run_migrations() — see CLEANUP_LOG.md.)
    logger.info("🚀 Starting...")
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
API_PREFIX = "/api"

app.include_router(face_auth_router, prefix=API_PREFIX)
app.include_router(pin_auth_router,  prefix=API_PREFIX)
app.include_router(registration_router, prefix=API_PREFIX)  
app.include_router(onboarding_router, prefix=API_PREFIX)
app.include_router(onboarding_profile_router, prefix=API_PREFIX)
app.include_router(chat_router, prefix=API_PREFIX)
app.include_router(docs_router, prefix=API_PREFIX)   # ✅ ADDED
app.include_router(meetings_router, prefix=API_PREFIX)
app.include_router(leaves_router, prefix=API_PREFIX)
app.include_router(notifications_router, prefix=API_PREFIX)
app.include_router(admin_router, prefix=API_PREFIX)
app.include_router(email_settings_router, prefix=API_PREFIX)
if _has_approvals:
    app.include_router(approval_requests_router, prefix=API_PREFIX)


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