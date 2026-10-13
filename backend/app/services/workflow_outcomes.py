"""Bounded, timezone-aware workflow success/failure trends for the admin metrics chart."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Callable, Iterable, Literal, Optional

from app.services.creation_activity import resolve_timezone

OutcomeRange = Literal["7d", "30d", "3m", "6m", "1y", "all"]
OutcomeGranularity = Literal["day", "week", "month"]

WORKFLOW_OPERATIONS: tuple[str, ...] = ("extraction", "generation", "regeneration", "export")

# Fixed ranges return a fixed number of buckets so the query and payload stay bounded.
FIXED_OUTCOME_RANGES: dict[str, tuple[OutcomeGranularity, int]] = {
    "7d": ("day", 7),
    "30d": ("day", 30),
    "3m": ("week", 13),
    "6m": ("week", 26),
    "1y": ("week", 52),
}
OUTCOME_RANGE_KEYS = frozenset({*FIXED_OUTCOME_RANGES, "all"})

# "All" sizes its buckets from the earliest event: days for a month of history, weeks for a
# year, months beyond that. Month buckets stop at ten years so the payload stays bounded.
ALL_RANGE_MAX_DAY_SPAN = 31
ALL_RANGE_MAX_WEEK_SPAN = 366
ALL_RANGE_MIN_DAY_BUCKETS = 7
MAX_MONTH_BUCKETS = 120


@dataclass(frozen=True)
class OutcomeWindow:
    range_key: str
    granularity: OutcomeGranularity
    timezone: str
    bucket_starts: tuple[date, ...]
    end_date: date
    start_at: datetime
    end_before: datetime

    @property
    def start_date(self) -> date:
        return self.bucket_starts[0]


@dataclass(frozen=True)
class DailyOperationOutcome:
    local_date: date
    event_type: str
    success: int
    failure: int


@dataclass(frozen=True)
class OutcomeCounts:
    success: int
    failure: int


@dataclass(frozen=True)
class OutcomeBucket:
    start_date: date
    end_date: date
    operations: dict[str, OutcomeCounts]


@dataclass(frozen=True)
class WorkflowOutcomes:
    range_key: str
    granularity: OutcomeGranularity
    timezone: str
    start_date: date
    end_date: date
    totals: dict[str, OutcomeCounts]
    buckets: tuple[OutcomeBucket, ...]


def _month_index(value: date) -> int:
    return value.year * 12 + value.month - 1


def _month_start(index: int) -> date:
    return date(index // 12, index % 12 + 1, 1)


def _week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def _all_range_shape(today: date, earliest: Optional[date]) -> tuple[OutcomeGranularity, int]:
    if earliest is None:
        return FIXED_OUTCOME_RANGES["30d"]
    earliest = min(earliest, today)
    span_days = (today - earliest).days + 1
    if span_days <= ALL_RANGE_MAX_DAY_SPAN:
        return "day", max(span_days, ALL_RANGE_MIN_DAY_BUCKETS)
    if span_days <= ALL_RANGE_MAX_WEEK_SPAN:
        return "week", (_week_start(today) - _week_start(earliest)).days // 7 + 1
    return "month", min(_month_index(today) - _month_index(earliest) + 1, MAX_MONTH_BUCKETS)


def build_outcome_window(
    range_key: str,
    timezone_name: str,
    now: datetime,
    load_earliest_event_at: Optional[Callable[[], Optional[datetime]]] = None,
) -> OutcomeWindow:
    """Validate the request, then size the window. The earliest-event lookup runs only for "all"."""
    if range_key not in OUTCOME_RANGE_KEYS:
        raise ValueError("Unsupported outcome range.")
    if now.tzinfo is None:
        raise ValueError("Outcome windows require an aware timestamp.")

    zone = resolve_timezone(timezone_name)
    today = now.astimezone(zone).date()

    if range_key == "all":
        earliest_at = load_earliest_event_at() if load_earliest_event_at else None
        earliest = earliest_at.astimezone(zone).date() if earliest_at else None
        granularity, bucket_count = _all_range_shape(today, earliest)
    else:
        granularity, bucket_count = FIXED_OUTCOME_RANGES[range_key]

    if granularity == "day":
        bucket_starts = tuple(today - timedelta(days=bucket_count - 1 - i) for i in range(bucket_count))
    elif granularity == "week":
        last = _week_start(today)
        bucket_starts = tuple(last - timedelta(weeks=bucket_count - 1 - i) for i in range(bucket_count))
    else:
        last = _month_index(today)
        bucket_starts = tuple(_month_start(last - (bucket_count - 1 - i)) for i in range(bucket_count))

    return OutcomeWindow(
        range_key=range_key,
        granularity=granularity,
        timezone=zone.key,
        bucket_starts=bucket_starts,
        end_date=today,
        start_at=datetime.combine(bucket_starts[0], time.min, tzinfo=zone),
        end_before=datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone),
    )


def _bucket_index(window: OutcomeWindow, value: date) -> int:
    if window.granularity == "day":
        return (value - window.start_date).days
    if window.granularity == "week":
        return (value - window.start_date).days // 7
    return _month_index(value) - _month_index(window.start_date)


def summarize_outcomes(
    window: OutcomeWindow, daily_rows: Iterable[DailyOperationOutcome]
) -> WorkflowOutcomes:
    bucket_count = len(window.bucket_starts)
    success = {op: [0] * bucket_count for op in WORKFLOW_OPERATIONS}
    failure = {op: [0] * bucket_count for op in WORKFLOW_OPERATIONS}

    for row in daily_rows:
        if row.event_type not in success:
            continue
        if row.local_date < window.start_date or row.local_date > window.end_date:
            continue
        index = _bucket_index(window, row.local_date)
        success[row.event_type][index] += row.success
        failure[row.event_type][index] += row.failure

    next_starts = window.bucket_starts[1:] + (window.end_date + timedelta(days=1),)
    buckets = tuple(
        OutcomeBucket(
            start_date=start,
            end_date=next_start - timedelta(days=1),
            operations={
                op: OutcomeCounts(success=success[op][index], failure=failure[op][index])
                for op in WORKFLOW_OPERATIONS
            },
        )
        for index, (start, next_start) in enumerate(zip(window.bucket_starts, next_starts))
    )
    return WorkflowOutcomes(
        range_key=window.range_key,
        granularity=window.granularity,
        timezone=window.timezone,
        start_date=window.start_date,
        end_date=window.end_date,
        totals={
            op: OutcomeCounts(success=sum(success[op]), failure=sum(failure[op]))
            for op in WORKFLOW_OPERATIONS
        },
        buckets=buckets,
    )
