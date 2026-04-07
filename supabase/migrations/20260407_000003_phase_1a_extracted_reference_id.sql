begin;

alter table public.applications
  add column if not exists extracted_reference_id text;

create index if not exists idx_applications_user_extracted_reference_id
  on public.applications (user_id, extracted_reference_id)
  where extracted_reference_id is not null;

commit;
