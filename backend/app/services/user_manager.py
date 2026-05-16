from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from app.core.config import Settings, get_settings
from app.core.security import hash_password
from app.db.admin import AdminRepository, get_admin_repository
from app.db.profiles import ProfileRepository, get_profile_repository
from app.db.users import UserRepository, get_user_repository

logger = logging.getLogger(__name__)


@dataclass
class UserManager:
    user_repo: UserRepository
    profile_repo: ProfileRepository
    admin_repo: AdminRepository
    settings: Settings

    def create_user(self, *, email: str, password: str) -> str:
        password_hash = hash_password(password)
        user = self.user_repo.create_user(email=email, password_hash=password_hash)
        self.profile_repo.update_profile(
            user_id=user.id,
            updates={
                "email": email,
            },
        )
        return user.id

    def set_user_password(self, *, user_id: str, password: str) -> None:
        password_hash = hash_password(password)
        self.user_repo.update_user_password(user_id=user_id, password_hash=password_hash)

    def update_user_email(self, *, user_id: str, email: str) -> None:
        self.user_repo.update_user_email(user_id=user_id, email=email)
        self.profile_repo.update_profile(user_id=user_id, updates={"email": email})

    def deactivate_user(self, *, user_id: str) -> None:
        self.user_repo.set_user_active(user_id=user_id, is_active=False)
        self.user_repo.revoke_all_user_tokens(user_id=user_id)

    def reactivate_user(self, *, user_id: str) -> None:
        self.user_repo.set_user_active(user_id=user_id, is_active=True)

    def delete_user(self, *, user_id: str) -> None:
        self.user_repo.delete_user(user_id=user_id)


def build_user_manager(
    settings: Optional[Settings] = None,
) -> UserManager:
    resolved = settings or get_settings()
    return UserManager(
        user_repo=UserRepository(resolved.database_url),
        profile_repo=ProfileRepository(resolved.database_url),
        admin_repo=AdminRepository(resolved.database_url),
        settings=resolved,
    )
