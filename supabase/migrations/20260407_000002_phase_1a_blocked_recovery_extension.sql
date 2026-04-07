begin;

alter table public.profiles
  add column if not exists extension_token_hash text,
  add column if not exists extension_token_created_at timestamptz,
  add column if not exists extension_token_last_used_at timestamptz;

create unique index if not exists idx_profiles_extension_token_hash
  on public.profiles (extension_token_hash)
  where extension_token_hash is not null;

alter table public.applications
  add column if not exists extraction_failure_details jsonb;

commit;
