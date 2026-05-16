from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any, Optional

from fastapi import Depends, Header, HTTPException, status
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.security import decode_access_token


class AuthenticatedUser(BaseModel):
    id: str
    email: Optional[str] = None
    role: Optional[str] = None
    claims: dict[str, Any]


class AuthVerifier:
    def __init__(self, settings: Settings) -> None:
        self.public_key = settings.jwt_public_key

    def verify_token(self, token: str) -> AuthenticatedUser:
        try:
            claims = decode_access_token(token, self.public_key)
        except InvalidTokenError as exc:
            raise self._unauthorized("Invalid or expired access token.") from exc

        subject = claims.get("sub")
        if not subject:
            raise self._unauthorized("Token subject is missing.")

        return AuthenticatedUser(
            id=subject,
            email=claims.get("email"),
            claims=claims,
        )

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
