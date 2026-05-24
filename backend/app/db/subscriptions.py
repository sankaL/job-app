from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.errors import QuotaExceededError


class SubscriptionTierRecord(BaseModel):
    key: str
    name: str
    monthly_resume_generation_limit: int
    generation_model: str
    generation_reasoning_effort: str = "none"
    generation_fallback_model: str
    generation_fallback_reasoning_effort: str = "none"
    is_active: bool
    created_at: str
    updated_at: str


class QuotaReservationRecord(BaseModel):
    subscription_tier: str
    monthly_resume_generation_limit: int
    generation_model: str
    generation_reasoning_effort: str = "none"
    generation_fallback_model: str
    generation_fallback_reasoning_effort: str = "none"
    period_start: str
    generation_count: int


class GenerationQuotaStatusRecord(BaseModel):
    subscription_tier: str
    monthly_resume_generation_limit: int
    generation_count: int
    remaining_count: int
    period_start: str
    resets_at: str


class SubscriptionRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connection(self):
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def list_tiers(self) -> list[SubscriptionTierRecord]:
        query = """
        select
          key,
          name,
          monthly_resume_generation_limit,
          generation_model,
          generation_reasoning_effort,
          generation_fallback_model,
          generation_fallback_reasoning_effort,
          is_active,
          created_at::text,
          updated_at::text
        from public.subscription_tiers
        where key in ('basic', 'pro')
        order by case key when 'basic' then 1 when 'pro' then 2 else 3 end
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()
        return [SubscriptionTierRecord.model_validate(row) for row in rows]

    def fetch_tier(self, *, tier_key: str) -> Optional[SubscriptionTierRecord]:
        query = """
        select
          key,
          name,
          monthly_resume_generation_limit,
          generation_model,
          generation_reasoning_effort,
          generation_fallback_model,
          generation_fallback_reasoning_effort,
          is_active,
          created_at::text,
          updated_at::text
        from public.subscription_tiers
        where key = %s
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (tier_key,))
            row = cursor.fetchone()
        return SubscriptionTierRecord.model_validate(row) if row else None

    def update_tier(
        self,
        *,
        tier_key: str,
        monthly_resume_generation_limit: int,
        generation_model: str,
        generation_reasoning_effort: str,
        generation_fallback_model: str,
        generation_fallback_reasoning_effort: str,
    ) -> SubscriptionTierRecord:
        query = """
        update public.subscription_tiers
        set
          monthly_resume_generation_limit = %s,
          generation_model = %s,
          generation_reasoning_effort = %s,
          generation_fallback_model = %s,
          generation_fallback_reasoning_effort = %s
        where key = %s
        returning key
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                query,
                (
                    monthly_resume_generation_limit,
                    generation_model,
                    generation_reasoning_effort,
                    generation_fallback_model,
                    generation_fallback_reasoning_effort,
                    tier_key,
                ),
            )
            row = cursor.fetchone()
            connection.commit()

        if row is None:
            raise LookupError("Subscription tier not found.")
        updated = self.fetch_tier(tier_key=tier_key)
        if updated is None:
            raise LookupError("Subscription tier not found.")
        return updated

    def reserve_generation_quota(self, *, user_id: str) -> QuotaReservationRecord:
        period_start = self.current_utc_period_start()
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute("set local lock_timeout = '5s'")
            cursor.execute("set local statement_timeout = '10s'")
            cursor.execute(
                """
                select
                  p.subscription_tier,
                  st.monthly_resume_generation_limit,
                  st.generation_model,
                  st.generation_reasoning_effort,
                  st.generation_fallback_model,
                  st.generation_fallback_reasoning_effort
                from public.profiles p
                join public.subscription_tiers st on st.key = p.subscription_tier
                where p.id = %s and p.is_active = true and st.is_active = true
                """,
                (user_id,),
            )
            tier_row = cursor.fetchone()
            if tier_row is None:
                raise PermissionError("An active subscription tier is required before generating resumes.")

            cursor.execute(
                """
                insert into public.resume_generation_usage (user_id, period_start, generation_count)
                values (%s, %s, 0)
                on conflict (user_id, period_start) do nothing
                """,
                (user_id, period_start),
            )
            cursor.execute(
                """
                select generation_count
                from public.resume_generation_usage
                where user_id = %s and period_start = %s
                for update
                """,
                (user_id, period_start),
            )
            usage_row = cursor.fetchone()
            if usage_row is None:
                connection.rollback()
                raise RuntimeError("Generation usage row was not created.")
            current_count = int(usage_row["generation_count"])
            limit = int(tier_row["monthly_resume_generation_limit"])
            if current_count >= limit:
                connection.rollback()
                raise QuotaExceededError(
                    "Monthly resume generation limit reached. Contact an administrator or upgrade your subscription tier."
                )

            cursor.execute(
                """
                update public.resume_generation_usage
                set generation_count = generation_count + 1
                where user_id = %s and period_start = %s
                returning generation_count
                """,
                (user_id, period_start),
            )
            updated_row = cursor.fetchone()
            connection.commit()

        return QuotaReservationRecord(
            subscription_tier=str(tier_row["subscription_tier"]),
            monthly_resume_generation_limit=limit,
            generation_model=str(tier_row["generation_model"]),
            generation_reasoning_effort=str(tier_row["generation_reasoning_effort"]),
            generation_fallback_model=str(tier_row["generation_fallback_model"]),
            generation_fallback_reasoning_effort=str(tier_row["generation_fallback_reasoning_effort"]),
            period_start=period_start.isoformat(),
            generation_count=int(updated_row["generation_count"]),
        )

    def fetch_generation_quota_status(self, *, user_id: str) -> GenerationQuotaStatusRecord:
        period_start = self.current_utc_period_start()
        resets_at = self.next_utc_period_start(period_start)
        query = """
        select
          p.subscription_tier,
          st.monthly_resume_generation_limit,
          coalesce(rgu.generation_count, 0)::int as generation_count
        from public.profiles p
        join public.subscription_tiers st on st.key = p.subscription_tier
        left join public.resume_generation_usage rgu
          on rgu.user_id = p.id
         and rgu.period_start = %s
        where p.id = %s and p.is_active = true and st.is_active = true
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (period_start, user_id))
            row = cursor.fetchone()
        if row is None:
            raise PermissionError("An active subscription tier is required before generating resumes.")
        limit = int(row["monthly_resume_generation_limit"])
        count = int(row["generation_count"])
        return GenerationQuotaStatusRecord(
            subscription_tier=str(row["subscription_tier"]),
            monthly_resume_generation_limit=limit,
            generation_count=count,
            remaining_count=max(limit - count, 0),
            period_start=period_start.isoformat(),
            resets_at=resets_at.isoformat(),
        )

    def release_generation_quota(self, *, user_id: str, period_start: str) -> None:
        period = date.fromisoformat(period_start)
        query = """
        update public.resume_generation_usage
        set generation_count = greatest(generation_count - 1, 0)
        where user_id = %s and period_start = %s
        """
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, (user_id, period))
            connection.commit()

    @staticmethod
    def current_utc_period_start() -> date:
        now = datetime.now(timezone.utc)
        return date(now.year, now.month, 1)

    @staticmethod
    def next_utc_period_start(period_start: date) -> date:
        if period_start.month == 12:
            return date(period_start.year + 1, 1, 1)
        return date(period_start.year, period_start.month + 1, 1)


def get_subscription_repository() -> SubscriptionRepository:
    return SubscriptionRepository(get_settings().database_url)
