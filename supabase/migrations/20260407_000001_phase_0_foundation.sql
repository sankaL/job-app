begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'visible_status_enum') then
    create type public.visible_status_enum as enum ('draft', 'needs_action', 'in_progress', 'complete');
  end if;

  if not exists (select 1 from pg_type where typname = 'internal_state_enum') then
    create type public.internal_state_enum as enum (
      'extraction_pending',
      'extracting',
      'manual_entry_required',
      'duplicate_review_required',
      'generation_pending',
      'generating',
      'resume_ready',
      'regenerating_section',
      'regenerating_full',
      'export_in_progress'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'failure_reason_enum') then
    create type public.failure_reason_enum as enum (
      'extraction_failed',
      'generation_failed',
      'regeneration_failed',
      'export_failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'duplicate_resolution_status_enum') then
    create type public.duplicate_resolution_status_enum as enum ('pending', 'dismissed', 'redirected');
  end if;

  if not exists (select 1 from pg_type where typname = 'job_posting_origin_enum') then
    create type public.job_posting_origin_enum as enum (
      'linkedin',
      'indeed',
      'google_jobs',
      'glassdoor',
      'ziprecruiter',
      'monster',
      'dice',
      'company_website',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_type_enum') then
    create type public.notification_type_enum as enum ('info', 'success', 'warning', 'error');
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text,
  phone text,
  address text,
  default_base_resume_id uuid,
  section_preferences jsonb not null default '{"summary": true, "professional_experience": true, "education": true, "skills": true}'::jsonb,
  section_order jsonb not null default '["summary", "professional_experience", "education", "skills"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.base_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  content_md text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint base_resumes_name_non_blank check (btrim(name) <> ''),
  constraint base_resumes_content_non_blank check (btrim(content_md) <> '')
);

alter table public.profiles
  drop constraint if exists profiles_default_base_resume_fk;

alter table public.profiles
  add constraint profiles_default_base_resume_fk
  foreign key (default_base_resume_id, id)
  references public.base_resumes (id, user_id)
  on delete set null;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_url text not null,
  job_title text,
  company text,
  job_description text,
  job_posting_origin public.job_posting_origin_enum,
  job_posting_origin_other_text text,
  base_resume_id uuid,
  visible_status public.visible_status_enum not null default 'draft',
  internal_state public.internal_state_enum not null default 'extraction_pending',
  failure_reason public.failure_reason_enum,
  applied boolean not null default false,
  duplicate_similarity_score numeric(5, 2),
  duplicate_match_fields jsonb,
  duplicate_resolution_status public.duplicate_resolution_status_enum,
  duplicate_matched_application_id uuid,
  notes text,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint applications_job_url_non_blank check (btrim(job_url) <> ''),
  constraint applications_duplicate_similarity_bounds check (
    duplicate_similarity_score is null
    or (duplicate_similarity_score >= 0 and duplicate_similarity_score <= 100)
  ),
  constraint applications_job_posting_origin_other_non_blank check (
    job_posting_origin_other_text is null or btrim(job_posting_origin_other_text) <> ''
  ),
  constraint applications_job_posting_origin_other_required check (
    (job_posting_origin = 'other' and job_posting_origin_other_text is not null)
    or (job_posting_origin is distinct from 'other' and job_posting_origin_other_text is null)
    or (job_posting_origin is null and job_posting_origin_other_text is null)
  )
);

alter table public.applications
  drop constraint if exists applications_base_resume_fk;

alter table public.applications
  add constraint applications_base_resume_fk
  foreign key (base_resume_id, user_id)
  references public.base_resumes (id, user_id)
  on delete set null;

alter table public.applications
  drop constraint if exists applications_duplicate_matched_application_fk;

alter table public.applications
  add constraint applications_duplicate_matched_application_fk
  foreign key (duplicate_matched_application_id, user_id)
  references public.applications (id, user_id)
  on delete set null;

create table if not exists public.resume_drafts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  content_md text not null,
  generation_params jsonb not null,
  sections_snapshot jsonb not null,
  last_generated_at timestamptz not null,
  last_exported_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (application_id),
  constraint resume_drafts_content_non_blank check (btrim(content_md) <> '')
);

alter table public.resume_drafts
  drop constraint if exists resume_drafts_application_fk;

alter table public.resume_drafts
  add constraint resume_drafts_application_fk
  foreign key (application_id, user_id)
  references public.applications (id, user_id)
  on delete cascade;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid,
  type public.notification_type_enum not null,
  message text not null,
  action_required boolean not null default false,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_message_non_blank check (btrim(message) <> '')
);

alter table public.notifications
  drop constraint if exists notifications_application_fk;

alter table public.notifications
  add constraint notifications_application_fk
  foreign key (application_id, user_id)
  references public.applications (id, user_id)
  on delete set null;

create index if not exists idx_base_resumes_user_updated_at on public.base_resumes (user_id, updated_at desc);
create index if not exists idx_base_resumes_user_name on public.base_resumes (user_id, name);
create index if not exists idx_applications_user_updated_at on public.applications (user_id, updated_at desc);
create index if not exists idx_applications_user_status_updated_at on public.applications (user_id, visible_status, updated_at desc);
create index if not exists idx_applications_user_duplicate_resolution on public.applications (user_id, duplicate_resolution_status);
create index if not exists idx_applications_unresolved_duplicates on public.applications (user_id, updated_at desc)
  where duplicate_resolution_status = 'pending';
create index if not exists idx_applications_search on public.applications
  using gin ((coalesce(job_title, '') || ' ' || coalesce(company, '')) gin_trgm_ops);
create unique index if not exists idx_resume_drafts_application on public.resume_drafts (application_id);
create index if not exists idx_notifications_user_read_created on public.notifications (user_id, read, created_at desc);
create index if not exists idx_notifications_unread_action_required on public.notifications (user_id, action_required, read, created_at desc)
  where action_required = true and read = false;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_base_resumes_updated_at on public.base_resumes;
create trigger set_base_resumes_updated_at
before update on public.base_resumes
for each row execute function public.set_updated_at();

drop trigger if exists set_applications_updated_at on public.applications;
create trigger set_applications_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

drop trigger if exists set_resume_drafts_updated_at on public.resume_drafts;
create trigger set_resume_drafts_updated_at
before update on public.resume_drafts
for each row execute function public.set_updated_at();

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do update
      set email = excluded.email,
          updated_at = now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    update public.profiles
    set email = new.email,
        updated_at = now()
    where id = new.id;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_inserted on auth.users;
create trigger on_auth_user_inserted
after insert on auth.users
for each row execute function public.handle_auth_user_change();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email on auth.users
for each row execute function public.handle_auth_user_change();

alter table public.profiles enable row level security;
alter table public.base_resumes enable row level security;
alter table public.applications enable row level security;
alter table public.resume_drafts enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select
using (auth.uid() = id);

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists base_resumes_owner_all on public.base_resumes;
create policy base_resumes_owner_all on public.base_resumes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists applications_owner_all on public.applications;
create policy applications_owner_all on public.applications
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists resume_drafts_owner_all on public.resume_drafts;
create policy resume_drafts_owner_all on public.resume_drafts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists notifications_owner_all on public.notifications;
create policy notifications_owner_all on public.notifications
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
