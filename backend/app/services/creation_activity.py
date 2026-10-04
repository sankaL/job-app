"""Bounded, timezone-aware application creation activity for the dashboard chart."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ActivityRange = Literal["7d", "30d", "3m", "1y"]
ActivityGranularity = Literal["day", "week"]

TIMEZONE_MAX_LENGTH = 64


@dataclass(frozen=True)
class ActivityRangeSpec:
    granularity: ActivityGranularity
    bucket_count: int


# Every range returns a fixed number of buckets so the query and payload stay bounded.
ACTIVITY_RANGES: dict[str, ActivityRangeSpec] = {
    "7d": ActivityRangeSpec(granularity="day", bucket_count=7),
    "30d": ActivityRangeSpec(granularity="day", bucket_count=30),
    "3m": ActivityRangeSpec(granularity="day", bucket_count=90),
    "1y": ActivityRangeSpec(granularity="week", bucket_count=52),
}


@dataclass(frozen=True)
class ActivityWindow:
    range_key: str
    granularity: ActivityGranularity
    timezone: str
    bucket_starts: tuple[date, ...]
    end_date: date
    start_at: datetime
    end_before: datetime

    @property
    def start_date(self) -> date:
        return self.bucket_starts[0]


@dataclass(frozen=True)
class DailyCreationCount:
    local_date: date
    created: int
    applied: int


@dataclass(frozen=True)
class ActivityBucket:
    start_date: date
    end_date: date
    created: int
    applied: int


@dataclass(frozen=True)
class CreationActivity:
    range_key: str
    granularity: ActivityGranularity
    timezone: str
    start_date: date
    end_date: date
    total_created: int
    total_applied: int
    buckets: tuple[ActivityBucket, ...]


def resolve_timezone(name: str) -> ZoneInfo:
    """Return the IANA zone or raise ValueError so callers fail closed."""
    candidate = name.strip()
    if not candidate or len(candidate) > TIMEZONE_MAX_LENGTH:
        raise ValueError("Unsupported timezone.")
    try:
        return ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Unsupported timezone.") from error


def build_activity_window(range_key: str, timezone_name: str, now: datetime) -> ActivityWindow:
    spec = ACTIVITY_RANGES.get(range_key)
    if spec is None:
        raise ValueError("Unsupported activity range.")
    if now.tzinfo is None:
        raise ValueError("Activity windows require an aware timestamp.")

    zone = resolve_timezone(timezone_name)
    today = now.astimezone(zone).date()

    if spec.granularity == "day":
        step = timedelta(days=1)
        last_start = today
    else:
        step = timedelta(weeks=1)
        last_start = today - timedelta(days=today.weekday())

    bucket_starts = tuple(
        last_start - step * (spec.bucket_count - 1 - index) for index in range(spec.bucket_count)
    )
    tomorrow = today + timedelta(days=1)
    return ActivityWindow(
        range_key=range_key,
        granularity=spec.granularity,
        timezone=zone.key,
        bucket_starts=bucket_starts,
        end_date=today,
        start_at=datetime.combine(bucket_starts[0], time.min, tzinfo=zone),
        end_before=datetime.combine(tomorrow, time.min, tzinfo=zone),
    )


def summarize_activity(window: ActivityWindow, daily_counts: Iterable[DailyCreationCount]) -> CreationActivity:
    created = [0] * len(window.bucket_starts)
    applied = [0] * len(window.bucket_starts)
    span_days = 1 if window.granularity == "day" else 7

    for row in daily_counts:
        if row.local_date < window.start_date or row.local_date > window.end_date:
            continue
        index = (row.local_date - window.start_date).days // span_days
        created[index] += row.created
        applied[index] += row.applied

    buckets = tuple(
        ActivityBucket(
            start_date=start,
            end_date=min(start + timedelta(days=span_days - 1), window.end_date),
            created=created[index],
            applied=applied[index],
        )
        for index, start in enumerate(window.bucket_starts)
    )
    return CreationActivity(
        range_key=window.range_key,
        granularity=window.granularity,
        timezone=window.timezone,
        start_date=window.start_date,
        end_date=window.end_date,
        total_created=sum(created),
        total_applied=sum(applied),
        buckets=buckets,
    )
