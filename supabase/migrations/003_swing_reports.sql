-- SwingCare swing_reports (밸런스 지수·진단 파생 결과)
-- session = 원본 랜드마크 / report = 점수·인사이트 분리

create table if not exists public.swing_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.swing_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  overall_score numeric(5, 1) not null,
  joint_scores jsonb not null,
  -- 예: {"lower_back":78,"wrist":45,"knee":82}
  issue_phase text,
  diagnosis_text text,
  recommended_drill_id text,
  scoring_version text not null default 'balance_score_v1',
  created_at timestamptz not null default now(),
  unique (session_id)
);

create index if not exists swing_reports_user_created_at_idx
  on public.swing_reports (user_id, created_at desc);

alter table public.swing_reports enable row level security;

drop policy if exists "swing_reports_select_own" on public.swing_reports;
create policy "swing_reports_select_own"
  on public.swing_reports for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "swing_reports_insert_own" on public.swing_reports;
create policy "swing_reports_insert_own"
  on public.swing_reports for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "swing_reports_update_own" on public.swing_reports;
create policy "swing_reports_update_own"
  on public.swing_reports for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "swing_reports_delete_own" on public.swing_reports;
create policy "swing_reports_delete_own"
  on public.swing_reports for delete to authenticated
  using (auth.uid() = user_id);
