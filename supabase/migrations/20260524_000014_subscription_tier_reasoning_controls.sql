begin;

alter table public.subscription_tiers
  add column if not exists generation_reasoning_effort text not null default 'none',
  add column if not exists generation_fallback_reasoning_effort text not null default 'none';

alter table public.subscription_tiers
  drop constraint if exists subscription_tiers_generation_reasoning_allowed,
  add constraint subscription_tiers_generation_reasoning_allowed
    check (generation_reasoning_effort in ('none', 'low', 'medium', 'high', 'xhigh')),
  drop constraint if exists subscription_tiers_generation_fallback_reasoning_allowed,
  add constraint subscription_tiers_generation_fallback_reasoning_allowed
    check (generation_fallback_reasoning_effort in ('none', 'low', 'medium', 'high', 'xhigh'));

update public.subscription_tiers
set
  generation_model = 'google/gemini-3-flash-preview',
  generation_reasoning_effort = 'none',
  generation_fallback_model = 'openai/gpt-5.4-mini',
  generation_fallback_reasoning_effort = 'none'
where key = 'basic';

update public.subscription_tiers
set
  generation_model = 'openai/gpt-5.4-mini',
  generation_reasoning_effort = 'medium',
  generation_fallback_model = 'google/gemini-3.5-flash',
  generation_fallback_reasoning_effort = 'medium'
where key = 'pro';

alter table public.subscription_tiers
  drop constraint if exists subscription_tiers_generation_model_allowed,
  add constraint subscription_tiers_generation_model_allowed
    check (generation_model in (
      'google/gemini-3-flash-preview',
      'openai/gpt-5.4-mini',
      'google/gemini-3.5-flash'
    )),
  drop constraint if exists subscription_tiers_generation_fallback_model_allowed,
  add constraint subscription_tiers_generation_fallback_model_allowed
    check (generation_fallback_model in (
      'google/gemini-3-flash-preview',
      'openai/gpt-5.4-mini',
      'google/gemini-3.5-flash'
    )),
  drop constraint if exists subscription_tiers_generation_model_reasoning_compatible,
  add constraint subscription_tiers_generation_model_reasoning_compatible
    check (
      generation_reasoning_effort <> 'xhigh'
      or generation_model = 'openai/gpt-5.4-mini'
    ),
  drop constraint if exists subscription_tiers_generation_fallback_model_reasoning_compatible,
  add constraint subscription_tiers_generation_fallback_model_reasoning_compatible
    check (
      generation_fallback_reasoning_effort <> 'xhigh'
      or generation_fallback_model = 'openai/gpt-5.4-mini'
    );

commit;
