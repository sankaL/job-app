begin;

alter table public.subscription_tiers
  drop constraint if exists subscription_tiers_generation_model_allowed,
  add constraint subscription_tiers_generation_model_allowed
    check (generation_model in (
      'google/gemini-3-flash-preview',
      'openai/gpt-5.4-mini',
      'deepseek/deepseek-v4-flash',
      'google/gemini-3.5-flash'
    )),
  drop constraint if exists subscription_tiers_generation_fallback_model_allowed,
  add constraint subscription_tiers_generation_fallback_model_allowed
    check (generation_fallback_model in (
      'google/gemini-3-flash-preview',
      'openai/gpt-5.4-mini',
      'deepseek/deepseek-v4-flash',
      'google/gemini-3.5-flash'
    )),
  drop constraint if exists subscription_tiers_generation_model_reasoning_compatible,
  add constraint subscription_tiers_generation_model_reasoning_compatible
    check (
      (
        generation_model = 'deepseek/deepseek-v4-flash'
        and generation_reasoning_effort in ('none', 'high', 'xhigh')
      )
      or (
        generation_model <> 'deepseek/deepseek-v4-flash'
        and (
          generation_reasoning_effort <> 'xhigh'
          or generation_model = 'openai/gpt-5.4-mini'
        )
      )
    ),
  drop constraint if exists subscription_tiers_generation_fallback_model_reasoning_compatible,
  add constraint subscription_tiers_generation_fallback_model_reasoning_compatible
    check (
      (
        generation_fallback_model = 'deepseek/deepseek-v4-flash'
        and generation_fallback_reasoning_effort in ('none', 'high', 'xhigh')
      )
      or (
        generation_fallback_model <> 'deepseek/deepseek-v4-flash'
        and (
          generation_fallback_reasoning_effort <> 'xhigh'
          or generation_fallback_model = 'openai/gpt-5.4-mini'
        )
      )
    );

commit;
