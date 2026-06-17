"""
tests/test_document_viewer_analytics.py

Unit tests for behavioral analytics — viewer + chat access logging,
cooldown de-spam, threshold evaluation, and cross-source combining.

Uses the existing SQLite test harness (tests/conftest.py).
Run with: pytest tests/test_document_viewer_analytics.py -v
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database.session import Base
from backend.database.models.behavior_analytics import DocumentTag, DocumentAccessLog, BehaviorAlert
from backend.database.models.rbac import Role
from backend.database.models.employee import Employee
from backend.enums import BehaviorAlertStatus, DocumentCategory, AccessSource
from backend.repositories.behavior_repository import BehaviorRepository
from backend.services.behavior_service import BehaviorService


# ── Isolated in-memory SQLite DB for this module ─────────────────────────────

@pytest.fixture(scope="module")
def engine():
    e = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=e)
    yield e
    Base.metadata.drop_all(bind=e)


@pytest.fixture
def db(engine):
    """Fresh transaction per test — rolled back on teardown."""
    connection = engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


# ── Seed helpers ──────────────────────────────────────────────────────────────

def seed_role(db, name="employee"):
    role = db.query(Role).filter(Role.name == name).first()
    if not role:
        role = Role(name=name, description=f"{name} role")
        db.add(role)
        db.commit()
        db.refresh(role)
    return role


def seed_employee(db, role_id, name="Test User", email="test@example.com"):
    emp = Employee(
        name=name,
        email=email,
        role_id=role_id,
        status="active",
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


def seed_tag(db, filename, category=DocumentCategory.SENSITIVE):
    tag = DocumentTag(filename=filename, category=category.value)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


# ── Repository tests ──────────────────────────────────────────────────────────

class TestBehaviorRepository:

    def test_get_category_for_tagged_file(self, db):
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)
        repo = BehaviorRepository(db)
        assert repo.get_category_for("NDA letter head copy.pdf") == DocumentCategory.SENSITIVE.value

    def test_get_category_for_untagged_file(self, db):
        repo = BehaviorRepository(db)
        assert repo.get_category_for("unknown_file.pdf") is None

    def test_log_access_chat(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="chat@example.com")
        seed_tag(db, "leave_policy.md", DocumentCategory.LEAVE_INTENT)
        repo = BehaviorRepository(db)

        entry = repo.log_access(
            emp.id, "leave_policy.md",
            DocumentCategory.LEAVE_INTENT.value,
            session_id=None,
            access_source=AccessSource.CHAT,
        )

        assert entry.id is not None
        assert entry.access_source == AccessSource.CHAT
        assert entry.filename == "leave_policy.md"

    def test_log_access_viewer(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="viewer@example.com")
        seed_tag(db, "onboarding_guide.md", DocumentCategory.GROWTH)
        repo = BehaviorRepository(db)

        entry = repo.log_access(
            emp.id, "onboarding_guide.md",
            DocumentCategory.GROWTH.value,
            session_id=None,
            access_source=AccessSource.VIEWER,
        )

        assert entry.access_source == AccessSource.VIEWER

    def test_recent_view_exists_within_cooldown(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="cooldown@example.com")
        seed_tag(db, "HR manual draft.md", DocumentCategory.SENSITIVE)
        repo = BehaviorRepository(db)

        repo.log_access(
            emp.id, "HR manual draft.md",
            DocumentCategory.SENSITIVE.value,
            session_id=None,
            access_source=AccessSource.VIEWER,
        )

        since = datetime.now(tz=timezone.utc) - timedelta(minutes=30)
        assert repo.recent_view_exists(emp.id, "HR manual draft.md", since) is True

    def test_recent_view_exists_outside_cooldown(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="nocooldown@example.com")
        seed_tag(db, "wfh_policy.md", DocumentCategory.LEAVE_INTENT)
        repo = BehaviorRepository(db)

        repo.log_access(
            emp.id, "wfh_policy.md",
            DocumentCategory.LEAVE_INTENT.value,
            session_id=None,
            access_source=AccessSource.VIEWER,
        )

        # Window is in the future — nothing should match
        since = datetime.now(tz=timezone.utc) + timedelta(minutes=30)
        assert repo.recent_view_exists(emp.id, "wfh_policy.md", since) is False

    def test_recent_view_exists_only_for_viewer_source(self, db):
        """Chat accesses must NOT count as cooldown guards for the viewer."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="chatsource@example.com")
        seed_tag(db, "employee_handbook.md", DocumentCategory.GROWTH)
        repo = BehaviorRepository(db)

        repo.log_access(
            emp.id, "employee_handbook.md",
            DocumentCategory.GROWTH.value,
            session_id=None,
            access_source=AccessSource.CHAT,   # chat, not viewer
        )

        since = datetime.now(tz=timezone.utc) - timedelta(minutes=30)
        # Should return False — chat logs don't block viewer cooldown
        assert repo.recent_view_exists(emp.id, "employee_handbook.md", since) is False

    def test_count_access_in_window_combines_sources(self, db):
        """Chat + viewer accesses both count toward the same window total."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="combined@example.com")
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)
        repo = BehaviorRepository(db)

        repo.log_access(emp.id, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE.value, None, AccessSource.CHAT)
        repo.log_access(emp.id, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE.value, None, AccessSource.VIEWER)

        since = datetime.now(tz=timezone.utc) - timedelta(days=7)
        count = repo.count_access_in_window(emp.id, DocumentCategory.SENSITIVE.value, since)
        assert count == 2


# ── Service tests ─────────────────────────────────────────────────────────────

class TestBehaviorServiceRecordView:
    """Tests for BehaviorService.record_view()"""

    def _make_service(self, db):
        svc = BehaviorService(db)
        # Suppress _notify_hr — no SMTP or real HR employees needed
        svc._notify_hr = MagicMock()
        return svc

    def test_record_view_creates_alert_at_threshold(self, db):
        """Two viewer opens (beyond cooldown) of a SENSITIVE doc should create one OPEN alert."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="viewalert@example.com")
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_SENSITIVE", 2),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            svc.record_view(emp.id, "NDA letter head copy.pdf")
            svc.record_view(emp.id, "NDA letter head copy.pdf")

        alerts = db.query(BehaviorAlert).filter(
            BehaviorAlert.employee_id == emp.id,
            BehaviorAlert.category == DocumentCategory.SENSITIVE.value,
        ).all()

        assert len(alerts) == 1
        assert alerts[0].status == BehaviorAlertStatus.OPEN

    def test_record_view_cooldown_blocks_duplicate(self, db):
        """Second open within cooldown window must not create a new log row."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="viewcooldown@example.com")
        seed_tag(db, "HR manual draft.md", DocumentCategory.SENSITIVE)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_SENSITIVE", 2),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 60),
        ):
            svc = self._make_service(db)
            svc.record_view(emp.id, "HR manual draft.md")   # logged
            svc.record_view(emp.id, "HR manual draft.md")   # blocked by cooldown

        logs = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
            DocumentAccessLog.filename == "HR manual draft.md",
            DocumentAccessLog.access_source == AccessSource.VIEWER,
        ).all()

        # Only one log row should exist
        assert len(logs) == 1

    def test_record_view_untagged_doc_not_logged(self, db):
        """Untagged documents must not generate any log rows."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="untagged@example.com")
        # Do NOT seed a tag for this file

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            svc.record_view(emp.id, "unknown_document.pdf")

        logs = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
        ).all()
        assert len(logs) == 0

    def test_record_view_disabled_when_analytics_off(self, db):
        """Nothing should be logged when BEHAVIOR_ANALYTICS_ENABLED=False."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="disabled@example.com")
        seed_tag(db, "leave_policy.md", DocumentCategory.LEAVE_INTENT)

        with patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", False):
            svc = self._make_service(db)
            svc.record_view(emp.id, "leave_policy.md")

        logs = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
        ).all()
        assert len(logs) == 0

    def test_record_view_fourth_open_updates_not_duplicates_alert(self, db):
        """After threshold, further opens update the existing alert — no new row created."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="update@example.com")
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_SENSITIVE", 2),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            for _ in range(4):
                svc.record_view(emp.id, "NDA letter head copy.pdf")

        alerts = db.query(BehaviorAlert).filter(
            BehaviorAlert.employee_id == emp.id,
            BehaviorAlert.category == DocumentCategory.SENSITIVE.value,
        ).all()

        assert len(alerts) == 1                     # still one alert
        assert alerts[0].trigger_count == 3         # updated 3 times after first creation


class TestBehaviorServiceCrossSource:
    """Chat + viewer accesses combine toward one threshold."""

    def _make_service(self, db):
        svc = BehaviorService(db)
        svc._notify_hr = MagicMock()
        return svc

    def test_chat_plus_viewer_combine_to_cross_threshold(self, db):
        """One chat access + one viewer access should cross threshold=2 and raise alert."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="crosssource@example.com")
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_SENSITIVE", 2),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)

            # Simulate one chat access
            svc.record_access(
                emp.id,
                [{"source_file": "NDA letter head copy.pdf", "section": "intro", "content": ""}],
                session_id=None,
            )

            # Simulate one viewer open
            svc.record_view(emp.id, "NDA letter head copy.pdf")

        alerts = db.query(BehaviorAlert).filter(
            BehaviorAlert.employee_id == emp.id,
            BehaviorAlert.category == DocumentCategory.SENSITIVE.value,
        ).all()

        assert len(alerts) == 1
        assert alerts[0].status == BehaviorAlertStatus.OPEN

        # Verify both access sources are in the log
        logs = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
            DocumentAccessLog.filename == "NDA letter head copy.pdf",
        ).all()
        sources_recorded = {log.access_source for log in logs}
        assert AccessSource.CHAT in sources_recorded
        assert AccessSource.VIEWER in sources_recorded

    def test_chat_access_does_not_set_viewer_cooldown(self, db):
        """A chat access must not block a subsequent viewer open via cooldown."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="nochatcooldown@example.com")
        seed_tag(db, "wfh_policy.md", DocumentCategory.LEAVE_INTENT)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_LEAVE_INTENT", 5),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 60),
        ):
            svc = self._make_service(db)
            svc.record_access(
                emp.id,
                [{"source_file": "wfh_policy.md", "section": "s1", "content": ""}],
            )
            svc.record_view(emp.id, "wfh_policy.md")  # must NOT be blocked

        viewer_logs = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
            DocumentAccessLog.filename == "wfh_policy.md",
            DocumentAccessLog.access_source == AccessSource.VIEWER,
        ).all()
        assert len(viewer_logs) == 1


class TestBehaviorServiceRecordAccess:
    """Regression — existing chat behaviour unchanged after viewer additions."""

    def _make_service(self, db):
        svc = BehaviorService(db)
        svc._notify_hr = MagicMock()
        return svc

    def test_chat_access_source_is_chat(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="chatsrc@example.com")
        seed_tag(db, "leave_policy.md", DocumentCategory.LEAVE_INTENT)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_LEAVE_INTENT", 10),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            svc.record_access(
                emp.id,
                [{"source_file": "leave_policy.md", "section": "s", "content": ""}],
            )

        log = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
        ).first()
        assert log is not None
        assert log.access_source == AccessSource.CHAT

    def test_chat_dedupes_multiple_chunks_same_doc(self, db):
        """Multiple chunks of the same doc in one chat response → only one log row."""
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="dedupe@example.com")
        seed_tag(db, "employee_handbook.md", DocumentCategory.GROWTH)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_GROWTH", 10),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            svc.record_access(
                emp.id,
                [
                    {"source_file": "employee_handbook.md", "section": "s1", "content": ""},
                    {"source_file": "employee_handbook.md", "section": "s2", "content": ""},
                    {"source_file": "employee_handbook.md", "section": "s3", "content": ""},
                ],
            )

        logs = db.query(DocumentAccessLog).filter(
            DocumentAccessLog.employee_id == emp.id,
            DocumentAccessLog.filename == "employee_handbook.md",
        ).all()
        assert len(logs) == 1  # deduped to one

    def test_creates_alert_after_threshold_chat(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="thresholdalert@example.com")
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_SENSITIVE", 3),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            for _ in range(3):
                svc.record_access(
                    emp.id,
                    [{"source_file": "NDA letter head copy.pdf", "section": "s", "content": ""}],
                )

        alerts = db.query(BehaviorAlert).filter(
            BehaviorAlert.employee_id == emp.id,
            BehaviorAlert.category == DocumentCategory.SENSITIVE.value,
        ).all()
        assert len(alerts) == 1
        assert alerts[0].status == BehaviorAlertStatus.OPEN

    def test_fourth_chat_access_updates_not_duplicates_alert(self, db):
        role = seed_role(db)
        emp = seed_employee(db, role.id, email="chatupdate@example.com")
        seed_tag(db, "NDA letter head copy.pdf", DocumentCategory.SENSITIVE)

        with (
            patch("backend.core.config.settings.BEHAVIOR_ANALYTICS_ENABLED", True),
            patch("backend.core.config.settings.BEHAVIOR_THRESHOLD_SENSITIVE", 3),
            patch("backend.core.config.settings.BEHAVIOR_WINDOW_DAYS", 7),
            patch("backend.core.config.settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES", 0),
        ):
            svc = self._make_service(db)
            for _ in range(4):
                svc.record_access(
                    emp.id,
                    [{"source_file": "NDA letter head copy.pdf", "section": "s", "content": ""}],
                )

        alerts = db.query(BehaviorAlert).filter(
            BehaviorAlert.employee_id == emp.id,
            BehaviorAlert.category == DocumentCategory.SENSITIVE.value,
        ).all()
        assert len(alerts) == 1
        assert alerts[0].trigger_count == 2  # created at 3rd, updated at 4th