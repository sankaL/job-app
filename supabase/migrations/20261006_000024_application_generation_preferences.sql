-- Per-application generation settings saved as the user changes them (aggressiveness,
-- target length, additional instructions), so they persist before a draft exists.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.applications
  add column if not exists generation_preferences jsonb;

comment on column public.applications.generation_preferences is
  'Saved generation settings: {page_length, aggressiveness, additional_instructions}. Null means use the draft''s last generation params.';

commit;
