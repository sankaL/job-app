from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from functools import lru_cache
from threading import Lock
from time import monotonic
from typing import Callable


@dataclass(frozen=True)
class AccessRequestGuardResult:
    is_duplicate: bool = False


class RateLimitExceededError(ValueError):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Too many access requests.")
        self.retry_after_seconds = retry_after_seconds


@dataclass
class AccessRequestGuard:
    max_requests_per_window: int = 5
    rate_limit_window_seconds: int = 600
    duplicate_window_seconds: int = 900
    clock: Callable[[], float] = monotonic
    _ip_attempts: dict[str, deque[float]] = field(default_factory=dict, init=False, repr=False)
    _recent_emails: dict[str, float] = field(default_factory=dict, init=False, repr=False)
    _lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def start_request(self, *, client_ip: str, email: str) -> AccessRequestGuardResult:
        now = self.clock()

        with self._lock:
            self._prune_stale_entries(now)

            recent_success_at = self._recent_emails.get(email)
            if recent_success_at is not None and now - recent_success_at < self.duplicate_window_seconds:
                return AccessRequestGuardResult(is_duplicate=True)

            attempts = self._ip_attempts.setdefault(client_ip, deque())
            while attempts and now - attempts[0] >= self.rate_limit_window_seconds:
                attempts.popleft()

            if len(attempts) >= self.max_requests_per_window:
                retry_after_seconds = max(
                    1,
                    int(self.rate_limit_window_seconds - (now - attempts[0])),
                )
                raise RateLimitExceededError(retry_after_seconds=retry_after_seconds)

            attempts.append(now)
            return AccessRequestGuardResult(is_duplicate=False)

    def mark_success(self, *, email: str) -> None:
        with self._lock:
            self._recent_emails[email] = self.clock()

    def _prune_stale_entries(self, now: float) -> None:
        stale_ips = [
            client_ip
            for client_ip, attempts in self._ip_attempts.items()
            if not attempts or now - attempts[-1] >= self.rate_limit_window_seconds
        ]
        for client_ip in stale_ips:
            self._ip_attempts.pop(client_ip, None)

        stale_emails = [
            email
            for email, last_success in self._recent_emails.items()
            if now - last_success >= self.duplicate_window_seconds
        ]
        for email in stale_emails:
            self._recent_emails.pop(email, None)


@lru_cache
def get_access_request_guard() -> AccessRequestGuard:
    return AccessRequestGuard()
