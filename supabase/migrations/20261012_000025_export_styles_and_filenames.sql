-- Export styles and per-base-resume download file names.
-- profiles.export_style remembers the last style the user exported with (null = Classic).
-- base_resumes.export_filename_template names files exported from drafts built on that
-- resume (null = "{first name} {last name} Resume"). Both columns are additive and nullable.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.profiles
  add column if not exists export_style text;

alter table public.profiles
  drop constraint if exists profiles_export_style_check;
alter table public.profiles
  add constraint profiles_export_style_check
  check (export_style is null or export_style in ('classic', 'modern', 'compact', 'executive', 'minimal'));

comment on column public.profiles.export_style is
  'Last export style used; pre-selected in the Export dialog. Null means classic.';

alter table public.base_resumes
  add column if not exists export_filename_template text;

alter table public.base_resumes
  drop constraint if exists base_resumes_export_filename_template_check;
alter table public.base_resumes
  add constraint base_resumes_export_filename_template_check
  check (
    export_filename_template is null
    or (btrim(export_filename_template) <> '' and char_length(export_filename_template) <= 120)
  );

comment on column public.base_resumes.export_filename_template is
  'Download file name template with {first name}, {last name}, {full name}, {company}, {job title}. Null means the default.';

commit;
