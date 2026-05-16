begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_users_email on public.users(email);
create index if not exists idx_refresh_tokens_user_id on public.refresh_tokens(user_id);
create index if not exists idx_refresh_tokens_token_hash on public.refresh_tokens(token_hash);

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

do $$
begin
  if to_regclass('auth.users') is not null then
    execute $sql$
      insert into public.users (id, email, password_hash, is_active, created_at, updated_at)
      select
        au.id,
        lower(coalesce(nullif(trim(au.email), ''), nullif(trim(p.email), ''))),
        crypt(gen_random_uuid()::text, gen_salt('bf')),
        coalesce(p.is_active, true),
        coalesce(au.created_at, now()),
        coalesce(au.updated_at, now())
      from auth.users au
      left join public.profiles p on p.id = au.id
      where coalesce(nullif(trim(au.email), ''), nullif(trim(p.email), '')) is not null
      on conflict (id) do update
      set email = excluded.email,
          is_active = excluded.is_active,
          updated_at = greatest(public.users.updated_at, excluded.updated_at)
    $sql$;
  end if;
end
$$;

insert into public.users (id, email, password_hash, is_active, created_at, updated_at)
select
  p.id,
  lower(p.email),
  crypt(gen_random_uuid()::text, gen_salt('bf')),
  coalesce(p.is_active, true),
  p.created_at,
  p.updated_at
from public.profiles p
where not exists (
  select 1
  from public.users u
  where u.id = p.id
)
on conflict (id) do nothing;

alter table public.profiles
  drop constraint if exists profiles_id_fkey,
  add constraint profiles_id_fkey foreign key (id) references public.users(id) on delete cascade;

alter table public.base_resumes
  drop constraint if exists base_resumes_user_id_fkey,
  add constraint base_resumes_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

alter table public.applications
  drop constraint if exists applications_user_id_fkey,
  add constraint applications_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

alter table public.resume_drafts
  drop constraint if exists resume_drafts_user_id_fkey,
  add constraint resume_drafts_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

alter table public.notifications
  drop constraint if exists notifications_user_id_fkey,
  add constraint notifications_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

alter table public.user_invites
  drop constraint if exists user_invites_invitee_user_id_fkey,
  add constraint user_invites_invitee_user_id_fkey foreign key (invitee_user_id) references public.users(id) on delete cascade,
  drop constraint if exists user_invites_invited_by_user_id_fkey,
  add constraint user_invites_invited_by_user_id_fkey foreign key (invited_by_user_id) references public.users(id) on delete cascade;

alter table public.usage_events
  drop constraint if exists usage_events_user_id_fkey,
  add constraint usage_events_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists base_resumes_owner_all on public.base_resumes;
drop policy if exists base_resumes_owner_select on public.base_resumes;
drop policy if exists base_resumes_owner_insert on public.base_resumes;
drop policy if exists base_resumes_owner_update on public.base_resumes;
drop policy if exists base_resumes_owner_delete on public.base_resumes;
drop policy if exists applications_owner_all on public.applications;
drop policy if exists resume_drafts_owner_all on public.resume_drafts;
drop policy if exists resume_drafts_owner_select on public.resume_drafts;
drop policy if exists resume_drafts_owner_insert on public.resume_drafts;
drop policy if exists resume_drafts_owner_update on public.resume_drafts;
drop policy if exists resume_drafts_owner_delete on public.resume_drafts;
drop policy if exists notifications_owner_all on public.notifications;
drop policy if exists user_invites_owner_select on public.user_invites;
drop policy if exists user_invites_owner_insert on public.user_invites;
drop policy if exists user_invites_owner_update on public.user_invites;
drop policy if exists usage_events_owner_select on public.usage_events;
drop policy if exists usage_events_owner_insert on public.usage_events;

alter table public.profiles disable row level security;
alter table public.base_resumes disable row level security;
alter table public.applications disable row level security;
alter table public.resume_drafts disable row level security;
alter table public.notifications disable row level security;
alter table public.user_invites disable row level security;
alter table public.usage_events disable row level security;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists on_auth_user_inserted on auth.users';
    execute 'drop trigger if exists on_auth_user_updated on auth.users';
  end if;
end
$$;

drop function if exists public.handle_auth_user_change();

commit;
