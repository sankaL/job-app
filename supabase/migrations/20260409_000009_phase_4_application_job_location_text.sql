begin;

alter table public.applications
add column if not exists job_location_text text;

commit;
