-- SwingCare: drills + subscriptions (홈 추천드릴 · 마이 구독)
-- coaches/coaching_requests 는 별도 승인 후 추가 (이번 파일 범위 밖)

create table if not exists public.drills (
  id text primary key,
  name text not null,
  description text,
  video_url text,
  target_issue text,
  category text,
  created_at timestamptz not null default now()
);

comment on table public.drills is
  '추천 드릴 카탈로그. swing_reports.recommended_drill_id 가 drills.id 를 참조(문자열)';

alter table public.drills enable row level security;

drop policy if exists "drills_select_authenticated" on public.drills;
create policy "drills_select_authenticated"
  on public.drills for select to authenticated
  using (true);

-- diagnosisTemplates.ts recommendedDrillId 와 동일 시드
insert into public.drills (id, name, description, target_issue, category)
values
  (
    'drill_towel_hip_lead',
    '타월 드릴 — 힙 리드 연습',
    '다운스윙 초반 상체가 먼저 열리는 습관을 잡아줘요. 타월을 끼고 힙이 먼저 돌아가게 연습하세요.',
    'over_the_top',
    'Conditioning'
  ),
  (
    'drill_step_weight_transfer',
    '스텝 스루 — 체중 이동',
    '임팩트에서 하체 리드로 체중이 앞으로 넘어가도록 스텝 스루로 밸런스를 맞춰 보세요.',
    'impact_weight_shift',
    'Impact'
  ),
  (
    'drill_wall_posture',
    '벽 터치 — 척추 각 유지',
    '다운스윙에서 골반이 일찍 일어서지 않도록 벽에 살짝 닿은 채 척추 각을 유지하는 컨디셔닝입니다.',
    'early_extension',
    'Posture'
  ),
  (
    'drill_smooth_tempo',
    '스무스 템포 드릴',
    '전반 리듬을 유지하는 템포 연습. 양호한 날을 이어가는 데 도움이 됩니다.',
    'overall_good',
    'Tempo'
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  target_issue = excluded.target_issue,
  category = excluded.category;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free', 'premium')),
  status text not null default 'active'
    check (status in ('active', 'canceled', 'expired', 'billing_issue')),
  revenuecat_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id);

comment on column public.subscriptions.revenuecat_id is
  'RevenueCat app_user_id 또는 entitlement 연동 키. 웹훅으로 갱신';

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "subscriptions_insert_own" on public.subscriptions;
create policy "subscriptions_insert_own"
  on public.subscriptions for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "subscriptions_update_own" on public.subscriptions;
create policy "subscriptions_update_own"
  on public.subscriptions for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
