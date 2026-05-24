begin;

create table if not exists public.subscription_tiers (
  key text primary key,
  name text not null,
  monthly_resume_generation_limit integer not null,
  generation_model text not null,
  generation_fallback_model text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_tiers_key_allowed check (key in ('basic', 'pro')),
  constraint subscription_tiers_name_non_blank check (btrim(name) <> ''),
  constraint subscription_tiers_limit_non_negative check (monthly_resume_generation_limit >= 0),
  constraint subscription_tiers_generation_model_non_blank check (btrim(generation_model) <> ''),
  constraint subscription_tiers_generation_fallback_model_non_blank check (btrim(generation_fallback_model) <> ''),
  constraint subscription_tiers_models_distinct check (generation_model <> generation_fallback_model)
);

insert into public.subscription_tiers (
  key,
  name,
  monthly_resume_generation_limit,
  generation_model,
  generation_fallback_model
)
values
  ('basic', 'Basic', 10, 'openai/gpt-5-mini', 'google/gemini-flash-1.5'),
  ('pro', 'Pro', 100, 'z-ai/glm-5.1', 'anthropic/claude-sonnet-4.6')
on conflict (key) do nothing;

drop trigger if exists set_subscription_tiers_updated_at on public.subscription_tiers;
create trigger set_subscription_tiers_updated_at
before update on public.subscription_tiers
for each row execute function public.set_updated_at();

alter table public.profiles
  add column if not exists subscription_tier text not null default 'basic';

update public.profiles
set subscription_tier = 'basic'
where subscription_tier is null or subscription_tier not in ('basic', 'pro');

alter table public.profiles
  drop constraint if exists profiles_subscription_tier_fkey,
  add constraint profiles_subscription_tier_fkey
    foreign key (subscription_tier)
    references public.subscription_tiers (key);

create table if not exists public.resume_generation_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  period_start date not null,
  generation_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start),
  constraint resume_generation_usage_count_non_negative check (generation_count >= 0)
);

create index if not exists idx_resume_generation_usage_period_start
  on public.resume_generation_usage (period_start);

drop trigger if exists set_resume_generation_usage_updated_at on public.resume_generation_usage;
create trigger set_resume_generation_usage_updated_at
before update on public.resume_generation_usage
for each row execute function public.set_updated_at();

commit;
