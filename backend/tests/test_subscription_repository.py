from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest

from app.core.errors import QuotaReservationBusyError
from app.db.subscriptions import SubscriptionRepository


def test_reserve_generation_quota_maps_lock_timeout_to_busy_error():
    repository = SubscriptionRepository("postgresql://unused")

    class BusyCursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, *_args, **_kwargs):
            raise psycopg.errors.LockNotAvailable("quota row is locked")

    class BusyConnection:
        def cursor(self):
            return BusyCursor()

    @contextmanager
    def busy_connection(*, user_id: str):
        assert user_id == "user-1"
        yield BusyConnection()

    repository._connection = busy_connection  # type: ignore[method-assign]

    with pytest.raises(QuotaReservationBusyError, match="Generation quota is busy"):
        repository.reserve_generation_quota(user_id="user-1")
