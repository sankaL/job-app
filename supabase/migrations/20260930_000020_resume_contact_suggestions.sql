begin;

-- Advisory local extraction is separate from authoritative profile contact.
alter table public.base_resumes
  add column if not exists contact_suggestions jsonb not null default '{}'::jsonb;

alter table public.base_resumes
  add constraint base_resumes_contact_suggestions_object check (jsonb_typeof(contact_suggestions) = 'object');

commit;
