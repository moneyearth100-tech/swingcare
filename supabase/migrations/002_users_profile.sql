-- SwingCare public.users (마스터스펙 7장 + 온보딩 프로필 게이트)
-- id = auth.users.id (익명·소셜 동일 UID / linkIdentity 전제)

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  age_group text
    check (
      age_group is null
      or age_group in ('20s', '30s', '40s', '50s', '60_plus')
    ),
  -- 칩 코드 배열 예: ["lower_back","wrist"] 또는 ["none"]
  injury_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(injury_history) = 'array'),
  handicap numeric(4, 1)
    check (handicap is null or (handicap >= 0 and handicap <= 54)),
  profile_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_profile_completed_at_idx
  on public.users (profile_completed_at);

alter table public.users enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
  on public.users for select to authenticated
  using (auth.uid() = id);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
  on public.users for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
  on public.users for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 기존 auth 유저 백필 (트리거 이전 가입분)
insert into public.users (id)
select id from auth.users
on conflict (id) do nothing;
