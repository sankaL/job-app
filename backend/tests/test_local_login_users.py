from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.users import UserRepository, get_user_repository
from app.main import app
from test_auth_endpoints import _make_settings


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_local_login_lists_existing_active_emails_only():
    repo = Mock(spec=UserRepository)
    repo.list_active_login_emails.return_value = ["admin@test.invalid", "member@test.invalid"]
    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: _make_settings(app_dev_mode=True)

    response = TestClient(app).get("/api/auth/local-users")

    assert response.status_code == 200
    assert response.json() == {"emails": ["admin@test.invalid", "member@test.invalid"]}
    assert response.headers["cache-control"] == "no-store"
    repo.list_active_login_emails.assert_called_once_with()
    repo.create_user.assert_not_called()


@pytest.mark.parametrize("app_env", ["production", "development"])
def test_local_login_list_is_unavailable_without_dev_mode(app_env):
    repo = Mock(spec=UserRepository)
    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: _make_settings(app_env=app_env)

    response = TestClient(app).get("/api/auth/local-users")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not found."}
    repo.list_active_login_emails.assert_not_called()


def test_local_login_list_can_be_empty():
    repo = Mock(spec=UserRepository)
    repo.list_active_login_emails.return_value = []
    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: _make_settings(app_dev_mode=True)

    response = TestClient(app).get("/api/auth/local-users")

    assert response.status_code == 200
    assert response.json() == {"emails": []}
