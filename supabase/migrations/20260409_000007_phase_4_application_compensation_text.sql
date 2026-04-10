begin;

alter table public.applications
add column if not exists compensation_text text;

commit;
