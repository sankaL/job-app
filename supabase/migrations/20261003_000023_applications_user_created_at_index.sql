-- Serve bounded dashboard creation-activity windows without scanning a user's full history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists idx_applications_user_created_at
  on public.applications (user_id, created_at desc);

commit;
