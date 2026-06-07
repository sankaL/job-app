begin;

alter table public.applications
  drop constraint if exists applications_job_url_non_blank;

alter table public.applications
  alter column job_url drop not null;

alter table public.applications
  add constraint applications_job_url_non_blank
  check (job_url is null or btrim(job_url) <> '');

commit;
