-- Phase 5: Full regeneration cap support per application

alter table public.applications
  add column if not exists full_regeneration_count integer not null default 0;

alter table public.applications
  drop constraint if exists applications_full_regeneration_count_non_negative;

alter table public.applications
  add constraint applications_full_regeneration_count_non_negative
  check (full_regeneration_count >= 0);
