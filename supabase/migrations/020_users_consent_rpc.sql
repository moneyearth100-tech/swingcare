-- 동의/유저행 보장: 클라이언트 upsert 가 RLS INSERT WITH CHECK 에서
-- (세션 미검증·uid 불일치·행 없음) 실패하는 경우를 security definer RPC 로 흡수.

begin;

create or replace function public.ensure_own_user_row()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.users;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.users (id)
  values (uid)
  on conflict (id) do nothing;

  select * into strict row
  from public.users
  where id = uid;

  return row;
end;
$$;

create or replace function public.save_labeling_data_consent()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.users;
  now_ts timestamptz := now();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.users (id)
  values (uid)
  on conflict (id) do nothing;

  update public.users
  set
    labeling_data_consent_at = now_ts,
    updated_at = now_ts
  where id = uid
  returning * into strict row;

  return row;
end;
$$;

revoke all on function public.ensure_own_user_row() from public, anon;
grant execute on function public.ensure_own_user_row() to authenticated;

revoke all on function public.save_labeling_data_consent() from public, anon;
grant execute on function public.save_labeling_data_consent() to authenticated;

commit;
