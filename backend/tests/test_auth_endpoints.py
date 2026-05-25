from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.auth import AuthVerifier, AuthenticatedUser, get_auth_verifier
from app.core.config import Settings, get_settings
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    generate_refresh_token,
    verify_password,
)
from app.db.profiles import ProfileRecord, ProfileRepository, get_profile_repository
from app.db.users import UserRepository, get_user_repository, UserRecord, RefreshTokenRecord
from app.main import app


TEST_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDazrjUk1XC+RxO
RKxIQyE8v8xz1MrwNqDmXfau6mlP5HNxG6kbyDwyk3wlvNsWcxn+drHogSVAq+ZY
aMRdvKvs0kpNvgExeEQNEdIBljjggqMiEadfptcCeNADku2yUd4QwRcLsAqucCF5
QShBpQWbvPF4J9TE5WVyAaJ4ltU2MdOE6oZhUCI/hKJ01Bv7W/utsIZ+jyj5Rnz0
5CcAdCcAgkCtdV7+EAWAISsvnrXhwVseIie67069hw+9zQvy20Use+jWjKKU3BxA
jgNmbs3tyefeiX/c/26EbTWugked+P8MtGiKKLmdYnCIS743mfPRDuGbPSFvHVmo
KErOejTHAgMBAAECggEASn4mnviqMf7tjBgFL3TrU+tYh/biQHXYwZUr7tEPmYuF
YfSw1iyNkgp0McTiMfpt1xxB5Y5SSHo9qcvBTsh1H+NYOK9/aIAxauGuRawHIShY
sbig6we6G7VV3GGhWxxUJhAW8Hu2pzy1qLpuIis0hZkF/IpS/dW7e9zim3t+izw6
J4VTMXVt//gkiwGumMdQ0yJ7o4RjVriAat5j0IAkuep7NI+lR+rPAfmDiG+vPtyy
pKSEtGpFz5/yceZh33Qd2OXEXNHZF2rd7NQVU5Z8AOxnY6eTml4l3jjVT5gAL4n6
OcN6ZVr/11p6/VhlX3m8MlWVk4iB9NEARIXcN+onwQKBgQD2NZ0R4FwkjttKuHk8
JghnadniG6BtCbewDxGkKTuObd2C6f2izfvntZ1M0X9uymNh7WbjDyH5zNv6LYTi
kEUKygOgo9+Z2aBFH7ceqPXkN/7GUzanKgJB7xkMC4cKoE+2wKolXza/HdTydXI4
DqEiyP83S3eUhoEtUEF1js+1IwKBgQDjgijkUR+wV3a3EY5CBP0v6Uve+Ixw6Imr
iiN7+CDDOy1yyGRBMgFP2mN+4nH7v8FFoqbIpzlvFAho+pByv94hRMfNibZrqmQT
EfJQUiCGTysjkBvIECKHlolznSNCx2OYHFYIUkLI/zRuGrRo+Pn3uEal5JV7UNk/
GMWwSH8WDQKBgCrwstI5VRizKZ/giJRq9bBDj9KViuc5eKXmGueMoWx30NhSQwAv
+K0yyZpqN1V1Stv7caRMMVrF1d/OLIzvKHt3PCa6LfdBM2ia3W8lfK0u7upb/P4u
n3IsZyvonsbFquFuvL4D2yJ963PV8/O+6W+NqqVULijjRIhIpQIBxEwNAoGBAINI
hsRJs9mUfyLg9JBQRLIzE98U2iYFafwc+KD+7Bj8uxszW/brHiqwQR3lGhVF8Ad4
9nlvVgstKjU58cTlxw63m/yVbTjv2FPQ1V1YJwCaCrC45e8qsGJBkguvL7vHR0dt
go/GuFc4PU8UBetVURmLsujj4QaJ/vMUHm+9Rei5AoGAQ3wSyYTPf8IG/oFBihNk
cOHYtbjNU1Vdf8ba4XUPswo/nHKV0kyQDkppb+22qyzi7F+85jTH44uSxwj6c5lb
iCPhk+xR4LYoNxYpCicW8DDsrHZjkmDv04mrTOQp/PdjtU6qZPNkYNQNM8JbP/j7
PhyreqLGV8+glSysPzaL6Nk=
-----END PRIVATE KEY-----"""

TEST_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2s641JNVwvkcTkSsSEMh
PL/Mc9TK8Dag5l32ruppT+RzcRupG8g8MpN8JbzbFnMZ/nax6IElQKvmWGjEXbyr
7NJKTb4BMXhEDRHSAZY44IKjIhGnX6bXAnjQA5LtslHeEMEXC7AKrnAheUEoQaUF
m7zxeCfUxOVlcgGieJbVNjHThOqGYVAiP4SidNQb+1v7rbCGfo8o+UZ89OQnAHQn
AIJArXVe/hAFgCErL5614cFbHiInuu9OvYcPvc0L8ttFLHvo1oyilNwcQI4DZm7N
7cnn3ol/3P9uhG01roJHnfj/DLRoiii5nWJwiEu+N5nz0Q7hmz0hbx1ZqChKzno0
xwIDAQAB
-----END PUBLIC KEY-----"""


def _make_settings(**overrides):
    defaults = {
        "app_env": "test",
        "app_dev_mode": False,
        "jwt_private_key": TEST_PRIVATE_KEY,
        "jwt_public_key": TEST_PUBLIC_KEY,
        "access_token_expire_minutes": 15,
        "refresh_token_expire_days": 7,
    }
    defaults.update(overrides)
    defaults["is_development"] = defaults["app_env"] == "development"
    defaults["is_local_dev_mode"] = defaults["app_dev_mode"]
    return type("Settings", (), defaults)()


def _make_user(*, user_id="user-1", email="test@example.com", password="TestPass123!", is_active=True):
    return UserRecord(
        id=user_id,
        email=email,
        password_hash=hash_password(password),
        is_active=is_active,
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )


class StubUserRepository:
    def __init__(self, *, user: Optional[UserRecord] = None):
        self.user = user
        self.refresh_tokens: dict[str, RefreshTokenRecord] = {}
        self.revoked_hashes: list[str] = []
        self.created_tokens: list[tuple[str, str, str]] = []
        self.rotated_tokens: list[dict] = []

    def fetch_user_by_email(self, *, email: str) -> Optional[UserRecord]:
        if self.user and self.user.email == email:
            return self.user
        return None

    def fetch_user_by_id(self, *, user_id: str) -> Optional[UserRecord]:
        if self.user and self.user.id == user_id:
            return self.user
        return None

    def create_user(self, *, email: str, password_hash: str) -> UserRecord:
        self.user = UserRecord(
            id="created-user-1",
            email=email,
            password_hash=password_hash,
            is_active=True,
            created_at="2026-01-01T00:00:00+00:00",
            updated_at="2026-01-01T00:00:00+00:00",
        )
        return self.user

    def create_refresh_token(self, *, user_id: str, token_hash: str, expires_at: str) -> None:
        self.created_tokens.append((user_id, token_hash, expires_at))

    def fetch_refresh_token(self, *, token_hash: str) -> Optional[RefreshTokenRecord]:
        return self.refresh_tokens.get(token_hash)

    def revoke_refresh_token(self, *, token_hash: str) -> None:
        self.revoked_hashes.append(token_hash)

    def revoke_all_user_tokens(self, *, user_id: str) -> None:
        self.revoked_hashes.append(f"all:{user_id}")

    def rotate_refresh_token(self, *, old_token_hash: str, user_id: str, new_token_hash: str, expires_at: str) -> None:
        self.rotated_tokens.append({
            "old_token_hash": old_token_hash,
            "user_id": user_id,
            "new_token_hash": new_token_hash,
            "expires_at": expires_at,
        })


class StubProfileRepository:
    def __init__(self):
        self.profile = ProfileRecord(
            id="user-1",
            email="test@example.com",
            first_name="Test",
            last_name="User",
            name="Test User",
            phone=None,
            address=None,
            linkedin_url=None,
            is_admin=False,
            is_active=True,
            onboarding_completed_at="2026-01-01T00:00:00+00:00",
            default_base_resume_id=None,
            section_preferences={},
            section_order=[],
            created_at="2026-01-01T00:00:00+00:00",
            updated_at="2026-01-01T00:00:00+00:00",
        )

    def fetch_profile(self, user_id: str) -> Optional[ProfileRecord]:
        return self.profile.model_copy(update={"id": user_id})

    def upsert_profile(self, user_id: str, updates: dict) -> Optional[ProfileRecord]:
        self.profile = self.profile.model_copy(update={"id": user_id, **updates})
        return self.profile


# ── Login endpoint tests ──


def test_login_success():
    user = _make_user()
    repo = StubUserRepository(user=user)
    settings = _make_settings()

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "TestPass123!"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 900
    # Refresh cookie should be set
    assert "refresh_token" in response.cookies
    assert "Secure" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]

    app.dependency_overrides.clear()


def test_login_uses_email_only_auth_in_local_dev_mode():
    user = _make_user()
    repo = StubUserRepository(user=user)
    profiles = StubProfileRepository()
    settings = _make_settings(app_env="development", app_dev_mode=True)

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_profile_repository] = lambda: profiles
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "wrong-password"})
    assert response.status_code == 200
    assert "refresh_token" in response.cookies
    assert "Secure" not in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]

    app.dependency_overrides.clear()


def test_login_requires_password_when_development_env_is_not_in_dev_mode():
    user = _make_user()
    repo = StubUserRepository(user=user)
    settings = _make_settings(app_env="development", app_dev_mode=False)

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "wrong-password"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."

    app.dependency_overrides.clear()


def test_login_wrong_email():
    repo = StubUserRepository(user=None)
    settings = _make_settings()

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "wrong@example.com", "password": "TestPass123!"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."

    app.dependency_overrides.clear()


def test_login_wrong_password():
    user = _make_user()
    repo = StubUserRepository(user=user)
    settings = _make_settings()

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "WrongPassword1!"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."

    app.dependency_overrides.clear()


def test_login_inactive_user():
    user = _make_user(is_active=False)
    repo = StubUserRepository(user=user)
    settings = _make_settings()

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "TestPass123!"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Account is deactivated."

    app.dependency_overrides.clear()


def test_login_email_is_lowercased():
    user = _make_user(email="test@example.com")
    repo = StubUserRepository(user=user)
    settings = _make_settings()

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "TEST@EXAMPLE.COM", "password": "TestPass123!"})
    assert response.status_code == 200

    app.dependency_overrides.clear()


def test_login_empty_password_hash_rejected():
    user = UserRecord(
        id="user-1",
        email="test@example.com",
        password_hash="",
        is_active=True,
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )
    repo = StubUserRepository(user=user)
    settings = _make_settings()

    app.dependency_overrides[get_user_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(app)

    response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "TestPass123!"})
    assert response.status_code == 401

    app.dependency_overrides.clear()


# ── Logout endpoint tests ──


def test_logout_with_valid_cookie():
    raw_refresh = generate_refresh_token()
    token_hash = hash_token(raw_refresh)
    repo = StubUserRepository()
    repo.refresh_tokens[token_hash] = RefreshTokenRecord(
        id="token-1",
        user_id="user-1",
        token_hash=token_hash,
        expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    app.dependency_overrides[get_user_repository] = lambda: repo
    client = TestClient(app)

    client.cookies.set("refresh_token", raw_refresh, path="/api/auth")
    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert token_hash in repo.revoked_hashes

    app.dependency_overrides.clear()


def test_logout_without_cookie():
    repo = StubUserRepository()
    app.dependency_overrides[get_user_repository] = lambda: repo
    client = TestClient(app)

    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    app.dependency_overrides.clear()


# ── /me endpoint tests ──


def test_me_with_valid_token():
    verifier = MagicMock()
    verifier.verify_token.return_value = AuthenticatedUser(
        id="user-1", email="test@example.com", claims={"sub": "user-1"}
    )
    profiles = StubProfileRepository()

    app.dependency_overrides[get_auth_verifier] = lambda: verifier
    app.dependency_overrides[get_profile_repository] = lambda: profiles
    client = TestClient(app)

    response = client.get("/api/auth/me", headers={"Authorization": "Bearer valid-token"})
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "user-1"
    assert data["email"] == "test@example.com"

    app.dependency_overrides.clear()


def test_me_without_token():
    client = TestClient(app)
    response = client.get("/api/auth/me")
    assert response.status_code == 401


# ── Password hashing tests ──


def test_hash_password_returns_bcrypt_hash():
    result = hash_password("TestPass123!")
    assert result.startswith("$2b$")
    assert result != "TestPass123!"


def test_verify_password_correct():
    hashed = hash_password("TestPass123!")
    assert verify_password("TestPass123!", hashed) is True


def test_verify_password_incorrect():
    hashed = hash_password("TestPass123!")
    assert verify_password("WrongPassword!", hashed) is False


def test_hash_password_different_salts():
    h1 = hash_password("TestPass123!")
    h2 = hash_password("TestPass123!")
    assert h1 != h2  # Different salts produce different hashes


# ── JWT iss claim tests ──


def test_create_access_token_includes_iss():
    token = create_access_token(
        user_id="user-1",
        email="test@example.com",
        private_key=TEST_PRIVATE_KEY,
    )
    import jwt
    claims = jwt.decode(token, TEST_PUBLIC_KEY, algorithms=["RS256"], options={"verify_exp": False})
    assert claims["iss"] == "resume-builder"


def test_decode_access_token_verifies_iss():
    token = create_access_token(
        user_id="user-1",
        email="test@example.com",
        private_key=TEST_PRIVATE_KEY,
        issuer="resume-builder",
    )
    from app.core.security import decode_access_token
    claims = decode_access_token(token, TEST_PUBLIC_KEY, issuer="resume-builder")
    assert claims["sub"] == "user-1"


def test_decode_access_token_rejects_wrong_iss():
    token = create_access_token(
        user_id="user-1",
        email="test@example.com",
        private_key=TEST_PRIVATE_KEY,
        issuer="wrong-issuer",
    )
    from app.core.security import decode_access_token
    import jwt as pyjwt
    with pytest.raises(pyjwt.exceptions.InvalidIssuerError):
        decode_access_token(token, TEST_PUBLIC_KEY, issuer="resume-builder")
