from pathlib import Path


MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260523_000013_subscription_tiers_generation_quotas.sql"
)
REASONING_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260524_000014_subscription_tier_reasoning_controls.sql"
)
DEEPSEEK_MODEL_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "20260524_000015_add_deepseek_v4_flash_subscription_model.sql"
)


def test_subscription_tiers_migration_declares_defaults_and_usage_contract():
    sql = MIGRATION_PATH.read_text()

    assert "create table if not exists public.subscription_tiers" in sql
    assert "create table if not exists public.resume_generation_usage" in sql
    assert "alter table public.profiles" in sql
    assert "subscription_tier text not null default 'basic'" in sql
    assert "foreign key (subscription_tier)" in sql
    assert "references public.subscription_tiers (key)" in sql
    assert "primary key (user_id, period_start)" in sql
    assert "monthly_resume_generation_limit" in sql
    assert "generation_model" in sql
    assert "generation_fallback_model" in sql

    assert "'basic', 'Basic', 10, 'openai/gpt-5-mini', 'google/gemini-flash-1.5'" in sql
    assert "'pro', 'Pro', 100, 'z-ai/glm-5.1', 'anthropic/claude-sonnet-4.6'" in sql


def test_subscription_reasoning_migration_adds_model_reasoning_contract():
    sql = REASONING_MIGRATION_PATH.read_text()

    assert "generation_reasoning_effort text not null default 'none'" in sql
    assert "generation_fallback_reasoning_effort text not null default 'none'" in sql
    assert "google/gemini-3-flash-preview" in sql
    assert "openai/gpt-5.4-mini" in sql
    assert "google/gemini-3.5-flash" in sql
    assert "generation_reasoning_effort <> 'xhigh'" in sql


def test_deepseek_model_migration_extends_model_and_reasoning_contract():
    sql = DEEPSEEK_MODEL_MIGRATION_PATH.read_text()

    assert "deepseek/deepseek-v4-flash" in sql
    assert "generation_reasoning_effort in ('none', 'high', 'xhigh')" in sql
    assert "generation_fallback_reasoning_effort in ('none', 'high', 'xhigh')" in sql
