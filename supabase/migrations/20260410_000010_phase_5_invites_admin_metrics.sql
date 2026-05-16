begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invite_status_enum') then
    create type public.invite_status_enum as enum ('pending', 'accepted', 'revoked', 'expired');
  end if;

  if not exists (select 1 from pg_type where typname = 'usage_event_status_enum') then
    create type public.usage_event_status_enum as enum ('success', 'failure', 'info');
  end if;
end
$$;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists onboarding_completed_at timestamptz;

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  invitee_user_id uuid not null references public.users (id) on delete cascade,
  invited_by_user_id uuid not null references public.users (id) on delete cascade,
  invited_email text not null,
  token_hash text not null unique,
  status public.invite_status_enum not null default 'pending',
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_invites_email_non_blank check (btrim(invited_email) <> ''),
  constraint user_invites_token_hash_non_blank check (btrim(token_hash) <> '')
);

create unique index if not exists idx_user_invites_pending_per_user
  on public.user_invites (invitee_user_id)
  where status = 'pending';

create index if not exists idx_user_invites_invited_by on public.user_invites (invited_by_user_id, created_at desc);
create index if not exists idx_user_invites_status on public.user_invites (status, created_at desc);
create index if not exists idx_user_invites_expires_at on public.user_invites (expires_at);

drop trigger if exists set_user_invites_updated_at on public.user_invites;
create trigger set_user_invites_updated_at
before update on public.user_invites
for each row execute function public.set_updated_at();

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  event_type text not null,
  event_status public.usage_event_status_enum not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint usage_events_event_type_non_blank check (btrim(event_type) <> '')
);

create index if not exists idx_usage_events_event_type_created_at
  on public.usage_events (event_type, created_at desc);
create index if not exists idx_usage_events_user_created_at
  on public.usage_events (user_id, created_at desc);
create index if not exists idx_usage_events_application_created_at
  on public.usage_events (application_id, created_at desc);

-- RLS removed — backend enforces user isolation at the application layer.

commit;
