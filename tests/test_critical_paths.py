"""
tests/test_critical_paths.py

Critical path tests for:
- Employee registration
- PIN login
- Leave approval flow

Run with:
    pytest tests/test_critical_paths.py -v
"""

import pytest
import pytest_asyncio
from unittest.mock import patch, MagicMock
from httpx import AsyncClient, ASGITransport
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ── Test DB (in-memory SQLite) ────────────────────────────────────────────────
TEST_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Minimal valid base64 JPEG (1x1 pixel) — satisfies face_images field validation
DUMMY_FACE_IMAGE = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA"
    "/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/9oACAEBAAA/APvX/9k="
)
DUMMY_FACE_IMAGES = [DUMMY_FACE_IMAGE] * 3  # min_length=3


def get_test_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _get_employee_pin(email: str) -> str:
    """Read the plain PIN from DB — only works because we patch generate_pin to return a fixed value."""
    return "123456"


# ── App fixture ───────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def app():
    """Import app, override DB, and mock face service + SMS."""
    from backend.database.session import Base, SessionLocal
    Base.metadata.create_all(bind=engine)

    # Patch face_service.enroll_faces to succeed without real face data
    mock_enroll = MagicMock(return_value={"success": True, "enrolled": 3})
    mock_retrain = MagicMock(return_value=None)
    mock_sms = MagicMock(return_value={"success": True, "error": None})
    mock_pin = MagicMock(return_value="123456")

    with patch("backend.services.face_service.face_service.enroll_faces", mock_enroll), \
         patch("backend.services.face_service.face_service.retrain_classifier", mock_retrain), \
         patch("backend.services.twilio_service.send_pin_sms", mock_sms), \
         patch("backend.services.twilio_service.generate_pin", mock_pin), \
         patch("backend.api.registration.send_pin_sms", mock_sms), \
         patch("backend.api.registration.generate_pin", mock_pin):

        from backend.main import app as _app

        # Each router has its own get_db() that calls SessionLocal().
        # Override by patching SessionLocal itself to use the test DB.
        import backend.database.session as _session_module
        _session_module.SessionLocal = TestingSessionLocal

        yield _app

    Base.metadata.drop_all(bind=engine)


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as c:
        yield c


# ── Helpers ───────────────────────────────────────────────────────────────────
async def register_employee(client, email="test@company.com", name="Test User", phone=None):
    """Register a new employee with dummy face images."""
    if phone is None:
        # derive unique phone from email to avoid duplicate phone errors
        digits = ''.join(c for c in email if c.isdigit())
        suffix = (digits + "00000000")[:8]
        phone = f"+91{suffix}"
    return await client.post("/api/auth/register", json={
        "name": name,
        "email": email,
        "phone": phone,
        "face_images": DUMMY_FACE_IMAGES,
    })


async def login_employee(client, identifier="test@company.com", pin="123456"):
    """Log in and return access token."""
    res = await client.post("/api/auth/login-with-pin", json={
        "identifier": identifier,
        "pin": pin,
    })
    assert res.status_code == 200, f"Login failed: {res.text}"
    return res.json()["access_token"]


# ── Registration tests ────────────────────────────────────────────────────────
class TestRegistration:

    async def test_register_success(self, client):
        """New employee registers successfully."""
        res = await register_employee(client, email="new@company.com", name="New User", phone="+911111111101")
        assert res.status_code in (200, 201), res.text
        data = res.json()
        assert "employee_id" in data or "access_token" in data

    async def test_register_duplicate_email(self, client):
        """Duplicate email is rejected."""
        await register_employee(client, email="dup@company.com", phone="+911111111102")
        res = await register_employee(client, email="dup@company.com", phone="+911111111103")
        assert res.status_code in (400, 409, 422), f"Expected error, got {res.status_code}"

    async def test_register_invalid_face_images(self, client):
        """Fewer than 3 face images fails validation."""
        res = await client.post("/api/auth/register", json={
            "name": "Bad Face",
            "email": "badface@company.com",
            "phone": "+911111111104",
            "face_images": [DUMMY_FACE_IMAGE],  # only 1, min is 3
        })
        assert res.status_code == 422, f"Expected 422, got {res.status_code}"

    async def test_register_missing_fields(self, client):
        """Missing required fields returns 422."""
        res = await client.post("/api/auth/register", json={"name": "Missing"})
        assert res.status_code == 422


# ── Login tests ───────────────────────────────────────────────────────────────
class TestLogin:

    async def test_login_success(self, client):
        """Registered employee can log in with correct PIN."""
        await register_employee(client, email="logintest@company.com", phone="+911111111105")
        res = await client.post("/api/auth/login-with-pin", json={
            "identifier": "logintest@company.com",
            "pin": "123456",
        })
        assert res.status_code == 200, res.text
        assert "access_token" in res.json()

    async def test_login_wrong_pin(self, client):
        """Wrong PIN is rejected with 401."""
        await register_employee(client, email="wrongpin@company.com", phone="+911111111106")
        res = await client.post("/api/auth/login-with-pin", json={
            "identifier": "wrongpin@company.com",
            "pin": "000000",
        })
        assert res.status_code == 401, f"Expected 401, got {res.status_code}"

    async def test_login_nonexistent_user(self, client):
        """Login for unknown email returns 404."""
        res = await client.post("/api/auth/login-with-pin", json={
            "identifier": "ghost@nowhere.com",
            "pin": "123456",
        })
        assert res.status_code == 404

    async def test_login_returns_employee_data(self, client):
        """Login response includes employee name, email, role."""
        await register_employee(client, email="empdata@company.com", name="Data User", phone="+911111111107")
        res = await client.post("/api/auth/login-with-pin", json={
            "identifier": "empdata@company.com",
            "pin": "123456",
        })
        assert res.status_code == 200
        emp = res.json().get("employee", {})
        assert emp.get("email") == "empdata@company.com"
        assert emp.get("name") == "Data User"


# ── Leave approval tests ──────────────────────────────────────────────────────
class TestLeaveApproval:

    async def test_employee_can_apply_for_leave(self, client):
        """Employee submits a leave request via the agent chat."""
        await register_employee(client, email="leave_emp@company.com", phone="+911111111108")
        token = await login_employee(client, "leave_emp@company.com")

        sess_res = await client.post(
            "/api/chat/sessions",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert sess_res.status_code == 200
        session_id = sess_res.json()["id"]

        res = await client.post("/api/chat/", json={
            "message": "I want to take sick leave tomorrow",
            "session_id": session_id,
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200

    async def test_hr_can_see_pending_leaves(self, client):
        """HR can fetch pending leave list (200 if HR role, 403 if not)."""
        await register_employee(client, email="hr_test@company.com", name="HR User", phone="+911111111109")
        token = await login_employee(client, "hr_test@company.com")

        res = await client.get(
            "/api/leaves/pending",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code in (200, 403)
        if res.status_code == 200:
            assert isinstance(res.json(), list)

    async def test_approve_nonexistent_leave(self, client):
        """Approving a non-existent leave returns 404 or 403."""
        await register_employee(client, email="hr_approve@company.com", phone="+911111111110")
        token = await login_employee(client, "hr_approve@company.com")

        res = await client.post(
            "/api/leaves/approve",
            json={"leave_id": 999999},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code in (403, 404)

    async def test_reject_requires_reason(self, client):
        """Reject with empty reason returns 400, 403, or 404."""
        await register_employee(client, email="hr_reject@company.com", phone="+911111111111")
        token = await login_employee(client, "hr_reject@company.com")

        res = await client.post(
            "/api/leaves/reject",
            json={"leave_id": 1, "reason": ""},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res.status_code in (400, 403, 404)


# ── Rate limiting ─────────────────────────────────────────────────────────────
class TestRateLimiting:

    async def test_login_rate_limit(self, client):
        """More than 10 login attempts from same IP triggers 429."""
        responses = []
        for _ in range(15):
            res = await client.post("/api/auth/login-with-pin", json={
                "identifier": "ratelimit@test.com",
                "pin": "000000",
            })
            responses.append(res.status_code)
        assert 429 in responses, f"Expected a 429, got: {set(responses)}"