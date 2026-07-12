-- SwingCare swing_sessions (5.4절 — 랜드마크 좌표만, 영상 미포함)
-- 확정: created_at 유지 / 익명 로그인 + user_id RLS / 인덱스 (user_id, created_at desc)
-- 개발 초기: 이전 초안 테이블이 있으면 재생성 (데이터 없음 가정)

drop table if exists public.swing_sessions cascade;

create table public.swing_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  duration_ms integer not null,
  platform text not null check (platform in ('ios', 'android')),
  fps double precision not null,
  frames jsonb not null default '[]'::jsonb,
  -- phases: PhaseMarker[] (detected|interpolated). 사람 검수용 phases_verified 분리는 추후 — landmarkTypes.ts NOTE 참고
  phases jsonb not null default '[]'::jsonb
);

create index swing_sessions_user_created_at_idx
  on public.swing_sessions (user_id, created_at desc);

alter table public.swing_sessions enable row level security;

create policy "swing_sessions_select_own"
  on public.swing_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "swing_sessions_insert_own"
  on public.swing_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "swing_sessions_update_own"
  on public.swing_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "swing_sessions_delete_own"
  on public.swing_sessions
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Dashboard → Authentication → Providers → Anonymous 활성화 필요
