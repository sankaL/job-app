from __future__ import annotations

import jwt
import pytest
from fastapi import HTTPException
from jwt.exceptions import PyJWKSetError

from app.core.auth import AuthVerifier


class EmptyJwkClient:
    def get_signing_key_from_jwt(self, token: str):
        raise PyJWKSetError("The JWK Set did not contain any keys")


def build_settings(*, jwt_secret: str | None):
    return type(
        "Settings",
        (),
        {
            "supabase_auth_jwks_url": "http://example.com/.well-known/jwks.json",
            "supabase_jwt_secret": jwt_secret,
            "supabase_jwt_audience": "authenticated",
            "supabase_jwt_issuer": None,
        },
    )()


def test_auth_verifier_falls_back_to_shared_secret_when_jwks_is_empty():
    verifier = AuthVerifier(build_settings(jwt_secret="super-secret-jwt-token-with-at-least-32-characters"))
    verifier._jwk_client = EmptyJwkClient()
    token = jwt.encode(
        {
            "sub": "user-123",
            "email": "invite-only@example.com",
            "role": "authenticated",
            "aud": "authenticated",
        },
        verifier.settings.supabase_jwt_secret,
        algorithm="HS256",
    )

    user = verifier.verify_token(token)

    assert user.id == "user-123"
    assert user.email == "invite-only@example.com"
    assert user.role == "authenticated"


def test_auth_verifier_rejects_empty_jwks_when_no_shared_secret_is_available():
    verifier = AuthVerifier(build_settings(jwt_secret=None))
    verifier._jwk_client = EmptyJwkClient()
    token = jwt.encode(
        {
            "sub": "user-123",
            "aud": "authenticated",
        },
        "unused-secret-that-is-still-over-thirty-two-characters",
        algorithm="HS256",
    )

    with pytest.raises(HTTPException) as exc_info:
        verifier.verify_token(token)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Unable to verify Supabase access token."
