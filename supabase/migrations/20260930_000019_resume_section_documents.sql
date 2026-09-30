begin;

-- Markdown remains the export projection. Documents are validated by the API;
-- nullable documents allow lazy, lossless conversion of historical rows.
alter table public.base_resumes
  add column if not exists document jsonb,
  add column if not exists revision integer not null default 1,
  add column if not exists raw_source_md text,
  add column if not exists import_warning text;

alter table public.resume_drafts
  add column if not exists document jsonb,
  add column if not exists source_snapshot jsonb,
  add column if not exists revision integer not null default 1;

alter table public.base_resumes
  add constraint base_resumes_document_object check (document is null or jsonb_typeof(document) = 'object'),
  add constraint base_resumes_positive_revision check (revision >= 1);

alter table public.resume_drafts
  add constraint resume_drafts_document_object check (document is null or jsonb_typeof(document) = 'object'),
  add constraint resume_drafts_source_snapshot_object check (source_snapshot is null or jsonb_typeof(source_snapshot) = 'object'),
  add constraint resume_drafts_positive_revision check (revision >= 1);

commit;
