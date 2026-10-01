-- Keep the oldest label and give later duplicates an available numbered suffix.
-- Lock writes during backfill so uniqueness is established atomically.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.base_resumes in share row exclusive mode;
do $$
declare
  duplicate record;
  candidate text;
  suffix integer;
begin
  for duplicate in
    select id, user_id, name from (
      select id, user_id, name,
        row_number() over (partition by user_id, lower(btrim(name)) order by created_at, id) as ordinal
      from public.base_resumes
    ) ranked where ordinal > 1 order by user_id, id
  loop
    suffix := 2;
    loop
      candidate := left(btrim(duplicate.name), 200 - length(' (' || suffix || ')')) || ' (' || suffix || ')';
      exit when not exists (
        select 1 from public.base_resumes
        where user_id = duplicate.user_id and lower(btrim(name)) = lower(candidate)
      );
      suffix := suffix + 1;
    end loop;
    update public.base_resumes set name = candidate, revision = revision + 1,
      document = case when document is null then null else jsonb_set(document, '{revision}', to_jsonb(revision + 1)) end
      where id = duplicate.id and user_id = duplicate.user_id;
  end loop;
end $$;
create unique index if not exists base_resumes_user_name_unique on public.base_resumes (user_id, lower(btrim(name)));
commit;
