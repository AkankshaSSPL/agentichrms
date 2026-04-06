"""
Agentic HRMS - Main FastAPI Application
Now with Face Recognition + PIN Login Support
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from alembic.config import Config
from alembic import command
import logging

from backend.core.config import settings
from backend.database.session import engine, Base

# Import your existing routers
# from backend.api.chat import router as chat_router
# from backend.api.docs import router as docs_router
# from backend.api.onboarding import router as onboarding_router

# 🆕 Import face auth router
from backend.api.face_auth import router as face_auth_router

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def run_migrations():
    """Run Alembic migrations on startup"""
    try:
        alembic_cfg = Config("alembic.ini")
        command.upgrade(alembic_cfg, "head")
        logger.info("✅ Database migrations completed")
    except Exception as e:
        logger.error(f"❌ Migration error: {e}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Startup
    logger.info("🚀 Starting Agentic HRMS...")
    run_migrations()
    logger.info("✅ Application ready")
    
    yield
    
    # Shutdown
    logger.info("👋 Shutting down Agentic HRMS...")


# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
# app.include_router(chat_router, prefix=settings.API_V1_PREFIX)
# app.include_router(docs_router, prefix=settings.API_V1_PREFIX)
# app.include_router(onboarding_router, prefix=settings.API_V1_PREFIX)

# 🆕 Include face auth router
app.include_router(face_auth_router, prefix=settings.API_V1_PREFIX)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Agentic HRMS API",
        "version": settings.VERSION,
        "features": [
            "RAG-powered HR chat",
            "Face recognition login",
            "PIN verification",
            "Leave management",
            "Onboarding workflow"
        ]
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "database": "connected",
        "face_recognition": "enabled"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.RELOAD
    )