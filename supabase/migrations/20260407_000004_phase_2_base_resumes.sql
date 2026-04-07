begin;

-- ============================================================================
-- Phase 2: Base Resumes and Resume Drafts RLS Policy Refinement
-- ============================================================================
-- This migration replaces the single 'ALL' RLS policies with granular
-- per-operation policies for base_resumes and resume_drafts tables.
-- ============================================================================

-- ============================================================================
-- base_resumes: Granular RLS Policies
-- ============================================================================

do $$
begin
  -- Drop the existing ALL policy if present
  drop policy if exists base_resumes_owner_all on public.base_resumes;

  -- Create individual policies for each operation
  -- SELECT: Users can read their own base resumes
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'base_resumes'
      and policyname = 'base_resumes_owner_select'
  ) then
    create policy base_resumes_owner_select on public.base_resumes
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  -- INSERT: Users can insert their own base resumes
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'base_resumes'
      and policyname = 'base_resumes_owner_insert'
  ) then
    create policy base_resumes_owner_insert on public.base_resumes
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  -- UPDATE: Users can update their own base resumes
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'base_resumes'
      and policyname = 'base_resumes_owner_update'
  ) then
    create policy base_resumes_owner_update on public.base_resumes
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  -- DELETE: Users can delete their own base resumes
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'base_resumes'
      and policyname = 'base_resumes_owner_delete'
  ) then
    create policy base_resumes_owner_delete on public.base_resumes
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

-- Ensure RLS is enabled on base_resumes
alter table public.base_resumes enable row level security;

-- ============================================================================
-- resume_drafts: Granular RLS Policies
-- ============================================================================

do $$
begin
  -- Drop the existing ALL policy if present
  drop policy if exists resume_drafts_owner_all on public.resume_drafts;

  -- Create individual policies for each operation
  -- SELECT: Users can read their own resume drafts
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resume_drafts'
      and policyname = 'resume_drafts_owner_select'
  ) then
    create policy resume_drafts_owner_select on public.resume_drafts
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  -- INSERT: Users can insert their own resume drafts
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resume_drafts'
      and policyname = 'resume_drafts_owner_insert'
  ) then
    create policy resume_drafts_owner_insert on public.resume_drafts
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  -- UPDATE: Users can update their own resume drafts
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resume_drafts'
      and policyname = 'resume_drafts_owner_update'
  ) then
    create policy resume_drafts_owner_update on public.resume_drafts
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  -- DELETE: Users can delete their own resume drafts
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resume_drafts'
      and policyname = 'resume_drafts_owner_delete'
  ) then
    create policy resume_drafts_owner_delete on public.resume_drafts
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

-- Ensure RLS is enabled on resume_drafts
alter table public.resume_drafts enable row level security;

-- ============================================================================
-- Index on base_resumes(user_id) for RLS performance
-- ============================================================================
-- Note: Phase 0 already created composite indexes that cover user_id:
--   - idx_base_resumes_user_updated_at (user_id, updated_at desc)
--   - idx_base_resumes_user_name (user_id, name)
-- These composite indexes support RLS lookups on user_id efficiently.
-- We add a standalone index for cases where only user_id is queried.

create index if not exists idx_base_resumes_user_id on public.base_resumes (user_id);

commit;
