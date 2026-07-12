-- Upload analysis pipeline: allow failure status + error message
-- Extends 004 check (pending|processing|done) with 'error'.

do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  join pg_namespace n on t.relnamespace = n.oid
  where n.nspname = 'public'
    and t.relname = 'swing_sessions'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%';

  if conname is not null then
    execute format('alter table public.swing_sessions drop constraint %I', conname);
  end if;
end $$;

alter table public.swing_sessions
  add constraint swing_sessions_status_check
  check (status in ('pending', 'processing', 'done', 'error'));

alter table public.swing_sessions
  add column if not exists analysis_error text;

comment on column public.swing_sessions.status is
  'upload: pending → processing → done|error. live default done.';

comment on column public.swing_sessions.analysis_error is
  '서버 분석 실패 메시지 (status=error 일 때). 성공 시 null.';
