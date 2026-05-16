from __future__ import annotations

from typing import Optional

import pytest

from app.core.security import hash_password, verify_password
from app.db.profiles import ProfileRecord
from app.db.users import UserRecord
from app.services.user_manager import UserManager


class StubUserRepo:
    def __init__(self):
        self.users: dict[str, dict] = {}
        self.password_updates: list[tuple[str, str]] = []
        self.email_updates: list[tuple[str, str]] = []
        self.active_updates: list[tuple[str, bool]] = []
        self.deleted_ids: list[str] = []
        self.revoked_user_ids: list[str] = []
        self._next_id = 1

    def create_user(self, *, email: str, password_hash: str) -> UserRecord:
        uid = f"user-{self._next_id}"
        self._next_id += 1
        self.users[uid] = {"id": uid, "email": email, "password_hash": password_hash}
        return UserRecord(
            id=uid, email=email, password_hash=password_hash,
            is_active=True, created_at="2026-01-01T00:00:00+00:00", updated_at="2026-01-01T00:00:00+00:00",
        )

    def update_user_password(self, *, user_id: str, password_hash: str) -> None:
        self.password_updates.append((user_id, password_hash))

    def update_user_email(self, *, user_id: str, email: str) -> None:
        self.email_updates.append((user_id, email))

    def set_user_active(self, *, user_id: str, is_active: bool) -> None:
        self.active_updates.append((user_id, is_active))

    def delete_user(self, *, user_id: str) -> None:
        self.deleted_ids.append(user_id)

    def revoke_all_user_tokens(self, *, user_id: str) -> None:
        self.revoked_user_ids.append(user_id)


class StubProfileRepo:
    def __init__(self):
        self.updates: list[tuple[str, dict]] = []

    def update_profile(self, user_id: str, updates: dict) -> Optional[ProfileRecord]:
        self.updates.append((user_id, updates))
        return None


class StubAdminRepo:
    pass


def _make_manager():
    user_repo = StubUserRepo()
    profile_repo = StubProfileRepo()
    admin_repo = StubAdminRepo()
    settings = type("Settings", (), {"database_url": "sqlite:///:memory:"})()
    manager = UserManager(
        user_repo=user_repo,
        profile_repo=profile_repo,
        admin_repo=admin_repo,
        settings=settings,
    )
    return manager, user_repo, profile_repo


def test_create_user_hashes_password():
    manager, user_repo, profile_repo = _make_manager()

    user_id = manager.create_user(email="test@example.com", password="MyPassword123!")

    assert user_id.startswith("user-")
    stored = user_repo.users[user_id]
    assert stored["email"] == "test@example.com"
    assert stored["password_hash"] != "MyPassword123!"
    assert stored["password_hash"].startswith("$2b$")
    # Profile should be updated with email
    assert any(upd[0] == user_id and upd[1].get("email") == "test@example.com" for upd in profile_repo.updates)


def test_set_user_password_hashes_before_storing():
    manager, user_repo, _ = _make_manager()
    user_id = manager.create_user(email="a@b.com", password="OldPass123!")

    manager.set_user_password(user_id=user_id, password="NewPass456!")

    assert len(user_repo.password_updates) == 1
    stored_hash = user_repo.password_updates[0][1]
    assert stored_hash != "NewPass456!"
    assert verify_password("NewPass456!", stored_hash)


def test_update_user_email_updates_both_repos():
    manager, user_repo, profile_repo = _make_manager()
    user_id = manager.create_user(email="old@example.com", password="Pass123!")

    manager.update_user_email(user_id=user_id, email="new@example.com")

    assert (user_id, "new@example.com") in user_repo.email_updates
    assert any(upd[0] == user_id and upd[1].get("email") == "new@example.com" for upd in profile_repo.updates)


def test_deactivate_user_sets_inactive_and_revokes_tokens():
    manager, user_repo, _ = _make_manager()
    user_id = manager.create_user(email="a@b.com", password="Pass123!")

    manager.deactivate_user(user_id=user_id)

    assert (user_id, False) in user_repo.active_updates
    assert user_id in user_repo.revoked_user_ids


def test_reactivate_user_sets_active():
    manager, user_repo, _ = _make_manager()
    user_id = manager.create_user(email="a@b.com", password="Pass123!")

    manager.reactivate_user(user_id=user_id)

    assert (user_id, True) in user_repo.active_updates


def test_delete_user_delegates():
    manager, user_repo, _ = _make_manager()
    user_id = manager.create_user(email="a@b.com", password="Pass123!")

    manager.delete_user(user_id=user_id)

    assert user_id in user_repo.deleted_ids
