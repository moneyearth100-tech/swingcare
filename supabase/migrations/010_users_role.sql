-- SwingCare: users.role (코치 웹 대시보드 접근 제어)
-- 코치 계정은 관리자가 Auth 유저 생성 후 role='coach' + coaches.auth_user_id 연결.
-- 가입 플로우는 범위 밖.

alter table public.users
  add column if not exists role text not null default 'user'
    check (role in ('user', 'coach', 'admin'));

comment on column public.users.role is
  'user=일반 / coach=코치 웹(/coach) 접근 / admin=운영';

create index if not exists users_role_idx on public.users (role);

-- 본인은 자기 role 을 바꿀 수 없음 (운영자가 service_role 로만 변경)
create or replace function public.users_prevent_role_self_escalation()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.uid() = old.id then
    -- service_role 은 auth.uid() null 인 경우가 많아 통과
    if auth.role() = 'authenticated' then
      raise exception 'users cannot change their own role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists users_prevent_role_self_escalation on public.users;
create trigger users_prevent_role_self_escalation
  before update on public.users
  for each row execute function public.users_prevent_role_self_escalation();
