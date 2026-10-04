"""Dashboard creation activity: bounded windows, local-day bucketing and route validation."""
import copy
import os
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.access import get_current_active_user
from app.db.applications import ApplicationRepository, DailyCreationCountRecord
from app.main import app
from app.services.application_manager import ApplicationService, get_application_service
from app.services.creation_activity import (
    DailyCreationCount,
    build_activity_window,
    summarize_activity,
)

# Saturday 2026-10-03 02:30 UTC is still Friday 2026-10-02 in Toronto.
NOW = datetime(2026, 10, 3, 2, 30, tzinfo=timezone.utc)


class RecordingRepository:
    def __init__(self, records):
        self.records = records
        self.calls = []

    def fetch_daily_creation_counts(self, user_id, *, timezone, start_at, end_before):
        self.calls.append(
            {"user_id": user_id, "timezone": timezone, "start_at": start_at, "end_before": end_before}
        )
        return self.records


def build_service(records=()):
    repository = RecordingRepository(list(records))
    service = ApplicationService.__new__(ApplicationService)
    service.repository = repository
    return service, repository


@pytest.fixture(autouse=True)
def restore_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


def test_daily_ranges_end_on_the_local_day_and_return_fixed_bucket_counts():
    for range_key, expected in (("7d", 7), ("30d", 30), ("3m", 90)):
        window = build_activity_window(range_key, "America/Toronto", NOW)
        assert window.granularity == "day"
        assert len(window.bucket_starts) == expected
        assert window.end_date == date(2026, 10, 2)
        assert window.bucket_starts[-1] == date(2026, 10, 2)
        assert window.start_date == date(2026, 10, 2) - timedelta(days=expected - 1)

    utc_window = build_activity_window("7d", "UTC", NOW)
    assert utc_window.end_date == date(2026, 10, 3)


def test_year_range_uses_52_monday_aligned_weeks_including_the_partial_current_week():
    window = build_activity_window("1y", "UTC", NOW)

    assert window.granularity == "week"
    assert len(window.bucket_starts) == 52
    assert all(start.weekday() == 0 for start in window.bucket_starts)
    assert window.bucket_starts[-1] == date(2026, 9, 28)
    assert window.start_date == date(2026, 9, 28) - timedelta(weeks=51)


def test_window_bounds_are_local_midnights():
    window = build_activity_window("7d", "America/Toronto", NOW)

    assert window.start_at == datetime(2026, 9, 26, 4, 0, tzinfo=timezone.utc)
    assert window.end_before == datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)
    assert window.timezone == "America/Toronto"


@pytest.mark.parametrize("range_key", ["", "12m", "all", "1Y"])
def test_unknown_ranges_fail_closed(range_key):
    with pytest.raises(ValueError, match="range"):
        build_activity_window(range_key, "UTC", NOW)


@pytest.mark.parametrize("timezone_name", ["", "Mars/Olympus", "../etc/passwd", "/UTC", "x" * 65])
def test_unknown_timezones_fail_closed(timezone_name):
    with pytest.raises(ValueError, match="timezone"):
        build_activity_window("7d", timezone_name, NOW)


def test_naive_clock_is_rejected():
    with pytest.raises(ValueError):
        build_activity_window("7d", "UTC", datetime(2026, 10, 3))


def test_summary_rolls_days_into_weeks_and_ignores_rows_outside_the_window():
    window = build_activity_window("1y", "UTC", NOW)
    activity = summarize_activity(
        window,
        [
            DailyCreationCount(local_date=window.start_date - timedelta(days=1), created=9, applied=9),
            DailyCreationCount(local_date=window.start_date, created=1, applied=0),
            DailyCreationCount(local_date=window.start_date + timedelta(days=6), created=2, applied=1),
            DailyCreationCount(local_date=date(2026, 9, 29), created=3, applied=2),
            DailyCreationCount(local_date=date(2026, 10, 4), created=7, applied=7),
        ],
    )

    assert activity.total_created == 6
    assert activity.total_applied == 3
    assert (activity.buckets[0].created, activity.buckets[0].applied) == (3, 1)
    assert activity.buckets[0].end_date == window.start_date + timedelta(days=6)
    assert activity.buckets[-1].start_date == date(2026, 9, 28)
    assert activity.buckets[-1].end_date == date(2026, 10, 3)
    assert (activity.buckets[-1].created, activity.buckets[-1].applied) == (3, 2)
    assert sum(bucket.created for bucket in activity.buckets[1:-1]) == 0


@pytest.mark.asyncio
async def test_service_queries_only_the_requested_window_for_the_user():
    service, repository = build_service(
        [DailyCreationCountRecord(local_date=date(2026, 10, 2), created_count=2, applied_count=1)]
    )

    activity = await service.get_creation_activity(
        user_id="user-1", range_key="30d", timezone_name="America/Toronto", now=NOW
    )

    assert repository.calls == [
        {
            "user_id": "user-1",
            "timezone": "America/Toronto",
            "start_at": datetime(2026, 9, 3, 4, 0, tzinfo=timezone.utc),
            "end_before": datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc),
        }
    ]
    assert len(activity.buckets) == 30
    assert (activity.buckets[-1].created, activity.buckets[-1].applied) == (2, 1)


def test_creation_activity_route_requires_authentication():
    response = TestClient(app).get("/api/applications/creation-activity")

    assert response.status_code == 401


def test_creation_activity_route_returns_bucketed_counts_for_the_current_user():
    service, repository = build_service(
        [DailyCreationCountRecord(local_date=date.today(), created_count=3, applied_count=1)]
    )
    app.dependency_overrides[get_current_active_user] = lambda: SimpleNamespace(id="owner")
    app.dependency_overrides[get_application_service] = lambda: service

    response = TestClient(app).get(
        "/api/applications/creation-activity", params={"range": "7d", "timezone": "UTC"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["range"] == "7d"
    assert body["granularity"] == "day"
    assert body["timezone"] == "UTC"
    assert len(body["buckets"]) == 7
    assert set(body["buckets"][0]) == {"start_date", "end_date", "created", "applied"}
    assert repository.calls[0]["user_id"] == "owner"


@pytest.mark.parametrize(
    "params",
    [{"range": "all"}, {"range": "7d", "timezone": "Mars/Olympus"}, {"timezone": ""}],
)
def test_creation_activity_route_rejects_invalid_filters(params):
    service, repository = build_service()
    app.dependency_overrides[get_current_active_user] = lambda: SimpleNamespace(id="owner")
    app.dependency_overrides[get_application_service] = lambda: service

    response = TestClient(app).get("/api/applications/creation-activity", params=params)

    assert response.status_code == 422
    assert repository.calls == []


@pytest.fixture
def local_activity_db():
    url = os.environ.get("DATABASE_URL", "")
    if os.environ.get("APP_DEV_MODE") != "true" or urlparse(url).hostname not in {"postgres", "localhost", "127.0.0.1"}:
        pytest.skip("Requires the Makefile-managed local development database.")
    users = [str(uuid4()), str(uuid4())]
    with psycopg.connect(url) as connection:
        for user in users:
            connection.execute(
                "insert into public.users (id,email,password_hash) values (%s,%s,%s)",
                (user, user + "@test.invalid", "test-only"),
            )
    try:
        yield url, users
    finally:
        with psycopg.connect(url) as connection:
            connection.execute("delete from public.users where id = any(%s::uuid[])", (users,))


def test_repository_aggregates_local_days_inside_the_window_for_one_user(local_activity_db):
    url, users = local_activity_db
    rows = [
        (users[0], "2026-10-03T03:30:00+00:00", True),  # Oct 2 in Toronto
        (users[0], "2026-10-02T15:00:00+00:00", False),
        (users[0], "2026-09-30T12:00:00+00:00", True),
        (users[0], "2026-09-01T12:00:00+00:00", True),  # before the 7-day window
        (users[1], "2026-10-02T15:00:00+00:00", True),  # another user
    ]
    with psycopg.connect(url) as connection:
        for user_id, created_at, applied in rows:
            connection.execute(
                "insert into public.applications (id,user_id,job_url,internal_state,visible_status,applied,created_at)"
                " values (%s,%s,%s,%s,%s,%s,%s)",
                (str(uuid4()), user_id, "https://example.com/job", "generation_pending", "draft", applied, created_at),
            )

    window = build_activity_window("7d", "America/Toronto", NOW)
    records = ApplicationRepository(url).fetch_daily_creation_counts(
        users[0], timezone=window.timezone, start_at=window.start_at, end_before=window.end_before
    )

    assert [(r.local_date, r.created_count, r.applied_count) for r in records] == [
        (date(2026, 9, 30), 1, 1),
        (date(2026, 10, 2), 2, 1),
    ]
