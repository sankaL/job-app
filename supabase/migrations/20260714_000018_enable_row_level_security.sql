begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

alter role app_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant app_runtime to current_user;

grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_runtime;
alter default privileges in schema public
  grant usage, select on sequences to app_runtime;

create schema if not exists app_security;
revoke all on schema app_security from public;
grant usage on schema app_security to app_runtime;

create or replace function app_security.current_user_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create or replace function app_security.has_service_access()
returns boolean
language sql
stable
parallel safe
as $$
  select coalesce(current_setting('app.service_access', true), '') = 'true'
$$;

revoke all on function app_security.current_user_id() from public;
revoke all on function app_security.has_service_access() from public;
grant execute on function app_security.current_user_id() to app_runtime;
grant execute on function app_security.has_service_access() to app_runtime;

alter table public.users enable row level security;
alter table public.users force row level security;
drop policy if exists users_isolation on public.users;
create policy users_isolation on public.users
  using (app_security.has_service_access() or id = app_security.current_user_id())
  with check (app_security.has_service_access() or id = app_security.current_user_id());

alter table public.refresh_tokens enable row level security;
alter table public.refresh_tokens force row level security;
drop policy if exists refresh_tokens_isolation on public.refresh_tokens;
create policy refresh_tokens_isolation on public.refresh_tokens
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
drop policy if exists profiles_isolation on public.profiles;
create policy profiles_isolation on public.profiles
  using (app_security.has_service_access() or id = app_security.current_user_id())
  with check (app_security.has_service_access() or id = app_security.current_user_id());

alter table public.base_resumes enable row level security;
alter table public.base_resumes force row level security;
drop policy if exists base_resumes_isolation on public.base_resumes;
create policy base_resumes_isolation on public.base_resumes
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.applications enable row level security;
alter table public.applications force row level security;
drop policy if exists applications_isolation on public.applications;
create policy applications_isolation on public.applications
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.resume_drafts enable row level security;
alter table public.resume_drafts force row level security;
drop policy if exists resume_drafts_isolation on public.resume_drafts;
create policy resume_drafts_isolation on public.resume_drafts
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
drop policy if exists notifications_isolation on public.notifications;
create policy notifications_isolation on public.notifications
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.user_invites enable row level security;
alter table public.user_invites force row level security;
drop policy if exists user_invites_select on public.user_invites;
drop policy if exists user_invites_service_write on public.user_invites;
create policy user_invites_select on public.user_invites for select
  using (
    app_security.has_service_access()
    or invitee_user_id = app_security.current_user_id()
    or invited_by_user_id = app_security.current_user_id()
  );
create policy user_invites_service_write on public.user_invites
  for all
  using (app_security.has_service_access())
  with check (app_security.has_service_access());

alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;
drop policy if exists usage_events_isolation on public.usage_events;
create policy usage_events_isolation on public.usage_events
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.resume_generation_usage enable row level security;
alter table public.resume_generation_usage force row level security;
drop policy if exists resume_generation_usage_isolation on public.resume_generation_usage;
create policy resume_generation_usage_isolation on public.resume_generation_usage
  using (app_security.has_service_access() or user_id = app_security.current_user_id())
  with check (app_security.has_service_access() or user_id = app_security.current_user_id());

alter table public.subscription_tiers enable row level security;
alter table public.subscription_tiers force row level security;
drop policy if exists subscription_tiers_read on public.subscription_tiers;
drop policy if exists subscription_tiers_service_write on public.subscription_tiers;
create policy subscription_tiers_read on public.subscription_tiers for select
  using (app_security.has_service_access() or app_security.current_user_id() is not null);
create policy subscription_tiers_service_write on public.subscription_tiers
  for all
  using (app_security.has_service_access())
  with check (app_security.has_service_access());

commit;
