"""Admin workflow outcomes: bounded windows, bucket rollups, admin-only route and validation."""
import copy
import os
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from psycopg import errors as pg_errors
from fastapi.testclient import TestClient

from app.core.access import get_current_profile, get_current_user
from app.db.usage_events import DailyOperationOutcomeRecord, UsageEventRepository
from app.main import app
from app.services.admin import AdminService, get_admin_service
from app.services.workflow_outcomes import (
    MAX_MONTH_BUCKETS,
    DailyOperationOutcome,
    build_outcome_window,
    summarize_outcomes,
)

# Saturday 2026-10-03 02:30 UTC is still Friday 2026-10-02 in Toronto.
NOW = datetime(2026, 10, 3, 2, 30, tzinfo=timezone.utc)


class RecordingUsageEvents:
    def __init__(self, records=(), earliest_at=None):
        self.records = list(records)
        self.earliest_at = earliest_at
        self.calls = []
        self.earliest_calls = 0

    def fetch_daily_operation_outcomes(self, *, timezone, start_at, end_before):
        self.calls.append({"timezone": timezone, "start_at": start_at, "end_before": end_before})
        return self.records

    def fetch_earliest_operation_event_at(self):
        self.earliest_calls += 1
        return self.earliest_at


def yesterday_utc():
    # Inside the 30-day window even if the request runs just after UTC midnight.
    return datetime.now(timezone.utc).date() - timedelta(days=1)


def build_service(records=(), earliest_at=None):
    usage_events = RecordingUsageEvents(records, earliest_at)
    service = AdminService.__new__(AdminService)
    service.usage_event_repository = usage_events
    return service, usage_events


def use_profile(*, is_admin):
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="admin-1")
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(is_active=True, is_admin=is_admin)


@pytest.fixture(autouse=True)
def restore_dependency_overrides():
    original = copy.copy(app.dependency_overrides)
    yield
    app.dependency_overrides = original


@pytest.mark.parametrize(
    ("range_key", "granularity", "bucket_count"),
    [("7d", "day", 7), ("30d", "day", 30), ("3m", "week", 13), ("6m", "week", 26), ("1y", "week", 52)],
)
def test_fixed_ranges_return_fixed_bucket_counts_ending_on_the_local_day(range_key, granularity, bucket_count):
    window = build_outcome_window(range_key, "America/Toronto", NOW)

    assert window.granularity == granularity
    assert len(window.bucket_starts) == bucket_count
    assert window.end_date == date(2026, 10, 2)
    if granularity == "week":
        assert all(start.weekday() == 0 for start in window.bucket_starts)
        assert window.bucket_starts[-1] == date(2026, 9, 28)
    else:
        assert window.bucket_starts[-1] == date(2026, 10, 2)


def test_window_bounds_are_local_midnights():
    window = build_outcome_window("7d", "America/Toronto", NOW)

    assert window.start_at == datetime(2026, 9, 26, 4, 0, tzinfo=timezone.utc)
    assert window.end_before == datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)


def test_window_bounds_follow_daylight_saving_changes():
    # Toronto leaves daylight saving time on Sunday 2026-11-01.
    window = build_outcome_window("7d", "America/Toronto", datetime(2026, 11, 4, 17, tzinfo=timezone.utc))

    assert window.start_at == datetime(2026, 10, 29, 4, 0, tzinfo=timezone.utc)
    assert window.end_before == datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)


def test_fixed_ranges_never_look_up_the_earliest_event():
    def fail():
        raise AssertionError("earliest event lookup should only run for 'all'")

    build_outcome_window("1y", "UTC", NOW, load_earliest_event_at=fail)


@pytest.mark.parametrize(
    ("earliest_at", "granularity", "bucket_count", "first_start"),
    [
        (None, "day", 30, date(2026, 9, 4)),
        (datetime(2026, 10, 2, 12, tzinfo=timezone.utc), "day", 7, date(2026, 9, 27)),
        (datetime(2026, 9, 10, 12, tzinfo=timezone.utc), "day", 24, date(2026, 9, 10)),
        (datetime(2026, 4, 15, 12, tzinfo=timezone.utc), "week", 25, date(2026, 4, 13)),
        (datetime(2024, 11, 20, 12, tzinfo=timezone.utc), "month", 24, date(2024, 11, 1)),
        (datetime(2001, 1, 1, 12, tzinfo=timezone.utc), "month", MAX_MONTH_BUCKETS, date(2016, 11, 1)),
        (datetime(2027, 1, 1, tzinfo=timezone.utc), "day", 7, date(2026, 9, 27)),
    ],
)
def test_all_range_sizes_buckets_from_the_earliest_event(earliest_at, granularity, bucket_count, first_start):
    window = build_outcome_window("all", "UTC", NOW, load_earliest_event_at=lambda: earliest_at)

    assert window.range_key == "all"
    assert window.granularity == granularity
    assert len(window.bucket_starts) == bucket_count
    assert window.start_date == first_start
    assert window.end_date == date(2026, 10, 3)


@pytest.mark.parametrize("range_key", ["", "12m", "ALL", "1w"])
def test_unknown_ranges_fail_closed(range_key):
    with pytest.raises(ValueError, match="range"):
        build_outcome_window(range_key, "UTC", NOW)


@pytest.mark.parametrize("timezone_name", ["", "Mars/Olympus", "../etc/passwd", "x" * 65])
def test_unknown_timezones_fail_closed_before_any_lookup(timezone_name):
    def fail():
        raise AssertionError("lookup must not run for an invalid timezone")

    with pytest.raises(ValueError, match="timezone"):
        build_outcome_window("all", timezone_name, NOW, load_earliest_event_at=fail)


def test_naive_clock_is_rejected():
    with pytest.raises(ValueError):
        build_outcome_window("7d", "UTC", datetime(2026, 10, 3))


def test_summary_rolls_days_into_weeks_per_operation_and_ignores_rows_outside_the_window():
    window = build_outcome_window("3m", "UTC", NOW)
    outcomes = summarize_outcomes(
        window,
        [
            DailyOperationOutcome(window.start_date - timedelta(days=1), "extraction", 9, 9),
            DailyOperationOutcome(window.start_date, "extraction", 2, 1),
            DailyOperationOutcome(window.start_date + timedelta(days=6), "extraction", 1, 0),
            DailyOperationOutcome(window.start_date + timedelta(days=6), "export", 4, 0),
            DailyOperationOutcome(date(2026, 10, 1), "generation", 3, 2),
            DailyOperationOutcome(date(2026, 10, 1), "unknown", 5, 5),
            DailyOperationOutcome(date(2026, 10, 4), "generation", 7, 7),
        ],
    )

    first, last = outcomes.buckets[0], outcomes.buckets[-1]
    assert (first.operations["extraction"].success, first.operations["extraction"].failure) == (3, 1)
    assert first.operations["export"].success == 4
    assert first.end_date == window.start_date + timedelta(days=6)
    assert last.start_date == date(2026, 9, 28)
    assert last.end_date == date(2026, 10, 3)
    assert (last.operations["generation"].success, last.operations["generation"].failure) == (3, 2)
    assert {op: (c.success, c.failure) for op, c in outcomes.totals.items()} == {
        "extraction": (3, 1),
        "generation": (3, 2),
        "regeneration": (0, 0),
        "export": (4, 0),
    }


def test_summary_rolls_days_into_calendar_months():
    window = build_outcome_window(
        "all", "UTC", NOW, load_earliest_event_at=lambda: datetime(2025, 1, 20, tzinfo=timezone.utc)
    )
    outcomes = summarize_outcomes(
        window,
        [
            DailyOperationOutcome(date(2025, 1, 20), "export", 1, 0),
            DailyOperationOutcome(date(2025, 2, 28), "export", 2, 1),
            DailyOperationOutcome(date(2026, 10, 3), "export", 5, 0),
        ],
    )

    assert window.granularity == "month"
    assert outcomes.buckets[0].start_date == date(2025, 1, 1)
    assert outcomes.buckets[1].end_date == date(2025, 2, 28)
    assert outcomes.buckets[1].operations["export"].failure == 1
    assert outcomes.buckets[-1].start_date == date(2026, 10, 1)
    assert outcomes.buckets[-1].end_date == date(2026, 10, 3)
    assert outcomes.totals["export"].success == 8


def test_service_queries_only_the_requested_window():
    service, usage_events = build_service(
        [DailyOperationOutcomeRecord(local_date=date(2026, 10, 2), event_type="generation", success_count=2, failure_count=1)]
    )

    outcomes = service.get_workflow_outcomes(range_key="30d", timezone_name="America/Toronto", now=NOW)

    assert usage_events.calls == [
        {
            "timezone": "America/Toronto",
            "start_at": datetime(2026, 9, 3, 4, 0, tzinfo=timezone.utc),
            "end_before": datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc),
        }
    ]
    assert usage_events.earliest_calls == 0
    assert len(outcomes.buckets) == 30
    assert outcomes.buckets[-1].operations["generation"].failure == 1


class RaisingCursor:
    def __init__(self, error):
        self.error = error
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        self.statements.append(statement)
        if "set local" not in statement:
            raise self.error


def repository_raising(monkeypatch, error):
    cursor = RaisingCursor(error)

    @contextmanager
    def fake_connection(self, **_kwargs):
        yield SimpleNamespace(cursor=lambda: cursor)

    monkeypatch.setattr(UsageEventRepository, "_connection", fake_connection)
    return UsageEventRepository("postgresql://unused"), cursor


def test_repository_maps_a_database_timezone_error_to_value_error(monkeypatch):
    repository, cursor = repository_raising(monkeypatch, pg_errors.InvalidParameterValue("bad zone"))

    with pytest.raises(ValueError, match="Unsupported timezone"):
        repository.fetch_daily_operation_outcomes(timezone="Mars/Olympus", start_at=NOW, end_before=NOW)
    assert cursor.statements[0] == "set local statement_timeout = '5s'"


@pytest.mark.parametrize("method", ["daily", "earliest"])
def test_repository_maps_a_statement_timeout_to_timeout_error(monkeypatch, method):
    repository, cursor = repository_raising(monkeypatch, pg_errors.QueryCanceled("statement timeout"))

    with pytest.raises(TimeoutError, match="too long"):
        if method == "daily":
            repository.fetch_daily_operation_outcomes(timezone="UTC", start_at=NOW, end_before=NOW)
        else:
            repository.fetch_earliest_operation_event_at()
    assert cursor.statements[0] == "set local statement_timeout = '5s'"


def test_route_reports_a_timeout_as_service_unavailable():
    service, _ = build_service()

    def slow(**_kwargs):
        raise TimeoutError("Workflow outcomes took too long to load. Try a shorter range.")

    service.get_workflow_outcomes = slow
    use_profile(is_admin=True)
    app.dependency_overrides[get_admin_service] = lambda: service

    response = TestClient(app).get("/api/admin/workflow-outcomes", params={"range": "all"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Workflow outcomes took too long to load. Try a shorter range."


def test_route_requires_an_admin():
    service, usage_events = build_service()
    use_profile(is_admin=False)
    app.dependency_overrides[get_admin_service] = lambda: service

    response = TestClient(app).get("/api/admin/workflow-outcomes")

    assert response.status_code == 403
    assert usage_events.calls == []


def test_route_requires_authentication():
    response = TestClient(app).get("/api/admin/workflow-outcomes")

    assert response.status_code == 401


def test_route_defaults_to_the_last_30_days():
    service, usage_events = build_service(
        [DailyOperationOutcomeRecord(local_date=yesterday_utc(), event_type="export", success_count=3, failure_count=1)]
    )
    use_profile(is_admin=True)
    app.dependency_overrides[get_admin_service] = lambda: service

    response = TestClient(app).get("/api/admin/workflow-outcomes", params={"timezone": "UTC"})

    assert response.status_code == 200
    body = response.json()
    assert body["range"] == "30d"
    assert body["granularity"] == "day"
    assert len(body["buckets"]) == 30
    assert set(body["buckets"][0]) == {"start_date", "end_date", "operations"}
    assert set(body["totals"]) == {"extraction", "generation", "regeneration", "export"}
    assert body["totals"]["export"] == {"success": 3, "failure": 1}
    assert len(usage_events.calls) == 1


def test_route_accepts_all():
    service, usage_events = build_service(earliest_at=datetime.now(timezone.utc) - timedelta(days=200))
    use_profile(is_admin=True)
    app.dependency_overrides[get_admin_service] = lambda: service

    response = TestClient(app).get("/api/admin/workflow-outcomes", params={"range": "all", "timezone": "UTC"})

    assert response.status_code == 200
    assert response.json()["granularity"] == "week"
    assert usage_events.earliest_calls == 1


@pytest.mark.parametrize(
    "params",
    [{"range": "12m"}, {"range": "7d", "timezone": "Mars/Olympus"}, {"timezone": ""}],
)
def test_route_rejects_invalid_filters(params):
    service, usage_events = build_service()
    use_profile(is_admin=True)
    app.dependency_overrides[get_admin_service] = lambda: service

    response = TestClient(app).get("/api/admin/workflow-outcomes", params=params)

    assert response.status_code == 422
    assert usage_events.calls == []


@pytest.fixture
def local_usage_db():
    url = os.environ.get("DATABASE_URL", "")
    if os.environ.get("APP_DEV_MODE") != "true" or urlparse(url).hostname not in {"postgres", "localhost", "127.0.0.1"}:
        pytest.skip("Requires the Makefile-managed local development database.")
    user = str(uuid4())
    with psycopg.connect(url) as connection:
        connection.execute(
            "insert into public.users (id,email,password_hash) values (%s,%s,%s)",
            (user, user + "@test.invalid", "test-only"),
        )
    try:
        yield url, user
    finally:
        with psycopg.connect(url) as connection:
            connection.execute("delete from public.users where id = %s", (user,))


def test_repository_aggregates_local_days_inside_the_window(local_usage_db):
    url, user = local_usage_db
    # Dates in 2001 keep real local dev usage out of the window.
    now = datetime(2001, 1, 10, 2, 30, tzinfo=timezone.utc)
    rows = [
        ("2001-01-10T03:30:00+00:00", "extraction", "failure"),  # Jan 9 in Toronto
        ("2001-01-09T15:00:00+00:00", "extraction", "success"),
        ("2001-01-09T15:00:00+00:00", "extraction", "info"),
        ("2001-01-05T12:00:00+00:00", "export", "success"),
        ("2001-01-05T12:00:00+00:00", "job_capture", "success"),  # not a workflow operation
        ("2000-12-01T12:00:00+00:00", "export", "success"),  # before the 7-day window
    ]
    with psycopg.connect(url) as connection:
        for created_at, event_type, event_status in rows:
            connection.execute(
                "insert into public.usage_events (user_id,event_type,event_status,created_at) values (%s,%s,%s,%s)",
                (user, event_type, event_status, created_at),
            )

    window = build_outcome_window("7d", "America/Toronto", now)
    repository = UsageEventRepository(url)
    records = repository.fetch_daily_operation_outcomes(
        timezone=window.timezone, start_at=window.start_at, end_before=window.end_before
    )

    assert [(r.local_date, r.event_type, r.success_count, r.failure_count) for r in records] == [
        (date(2001, 1, 5), "export", 1, 0),
        (date(2001, 1, 9), "extraction", 1, 1),
    ]
    earliest = repository.fetch_earliest_operation_event_at()
    assert earliest is not None and earliest <= datetime(2000, 12, 1, 12, tzinfo=timezone.utc)
