from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any, Optional

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError, PyJWKSetError
from pydantic import BaseModel

from app.core.config import Settings, get_settings


class AuthenticatedUser(BaseModel):
    id: str
    email: Optional[str] = None
    role: Optional[str] = None
    claims: dict[str, Any]


class AuthVerifier:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwk_client = PyJWKClient(settings.supabase_auth_jwks_url)

    def verify_token(self, token: str) -> AuthenticatedUser:
        claims = self._decode(token)
        subject = claims.get("sub")
        if not subject:
            raise self._unauthorized("Token subject is missing.")

        return AuthenticatedUser(
            id=subject,
            email=claims.get("email"),
            role=claims.get("role"),
            claims=claims,
        )

    def _decode(self, token: str) -> dict[str, Any]:
        decode_kwargs: dict[str, Any] = {
            "audience": self.settings.supabase_jwt_audience,
            "algorithms": ["RS256", "ES256", "HS256"],
            "options": {"verify_iss": bool(self.settings.supabase_jwt_issuer)},
        }

        if self.settings.supabase_jwt_issuer:
            decode_kwargs["issuer"] = self.settings.supabase_jwt_issuer

        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(token)
            return jwt.decode(token, signing_key.key, **decode_kwargs)
        except (PyJWKClientError, PyJWKSetError, InvalidTokenError):
            if not self.settings.supabase_jwt_secret:
                raise self._unauthorized("Unable to verify Supabase access token.")

            try:
                return jwt.decode(token, self.settings.supabase_jwt_secret, **decode_kwargs)
            except InvalidTokenError as exc:
                raise self._unauthorized("Invalid Supabase access token.") from exc

    @staticmethod
    def _unauthorized(detail: str) -> HTTPException:
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


@lru_cache
def get_auth_verifier() -> AuthVerifier:
    return AuthVerifier(get_settings())


def get_current_user(
    authorization: Annotated[Optional[str], Header(alias="Authorization")] = None,
    verifier: AuthVerifier = Depends(get_auth_verifier),
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    return verifier.verify_token(token)
