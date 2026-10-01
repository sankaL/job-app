begin;

-- Plans now control request allowances only. Preserve historical model columns
-- for compatibility/rollback; current API and workers never consult them.
update public.subscription_tiers
set monthly_resume_generation_limit = case key when 'basic' then 10 when 'pro' then 60 end
where key in ('basic', 'pro');

comment on column public.subscription_tiers.generation_model is 'Deprecated compatibility metadata; operation-based worker configuration selects models.';
comment on column public.subscription_tiers.generation_fallback_model is 'Deprecated compatibility metadata; operation-based worker configuration selects fallback models.';
comment on column public.subscription_tiers.generation_reasoning_effort is 'Deprecated compatibility metadata; current AI operations use provider-default reasoning.';
comment on column public.subscription_tiers.generation_fallback_reasoning_effort is 'Deprecated compatibility metadata; current AI operations use provider-default reasoning.';

commit;
