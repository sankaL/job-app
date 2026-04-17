alter table public.applications
add column if not exists resume_judge_result jsonb;
