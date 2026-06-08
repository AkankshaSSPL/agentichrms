"""
conftest.py — D:\agentichrms-main\tests\conftest.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pytest_asyncio
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database.session import Base, get_db
from backend.main import app
import httpx

# ── Test DB ───────────────────────────────────────────────────────────────────
TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "test.db")
if os.path.exists(TEST_DB_PATH):
    os.remove(TEST_DB_PATH)

TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"
test_engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session", autouse=True)
def create_test_tables():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest_asyncio.fixture
async def client(create_test_tables):
    app.dependency_overrides[get_db] = override_get_db

    with patch("backend.main.run_migrations", return_value=None):
        async with httpx.AsyncClient(app=app, base_url="http://test") as c:
            yield c

    app.dependency_overrides.clear()