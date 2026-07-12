-- SwingCare Phase 2: challenges / user_challenges / league_seasons / user_league_progress
-- 친구 랭킹은 friendships 없이 글로벌(최신 swing_reports.overall_score) 집계 — get_global_leaderboard()
--
-- target_issue 매칭:
--   DiagnosisPatternId (diagnosisTemplates.ts) 와 동일 문자열을 쓴다.
--   over_the_top | impact_weight_shift | early_extension
--   ※ swing_reports.issue_phase 는 SwingPhase(구간)라서 target_issue 와 다름.
--     진행도 갱신은 세션 저장 시점의 diagnosis.patternId 로 매칭한다.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('mission', 'league')),
  duration_days integer not null check (duration_days > 0),
  badge_id text,
  -- 스펙 외: 목업 progress "2/3" · 세션 매칭용
  goal_count integer not null default 1 check (goal_count > 0),
  target_issue text
    check (
      target_issue is null
      or target_issue in (
        'over_the_top',
        'impact_weight_shift',
        'early_extension'
      )
    ),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists challenges_active_type_idx
  on public.challenges (is_active, type);

comment on column public.challenges.target_issue is
  'DiagnosisPatternId. issue_phase(구간)와 혼동 금지. 세션 저장 시 patternId로 매칭';

create table if not exists public.user_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, challenge_id)
);

create index if not exists user_challenges_user_idx
  on public.user_challenges (user_id);

create index if not exists user_challenges_challenge_idx
  on public.user_challenges (challenge_id);

create table if not exists public.league_seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- 예: {"bogey":0,"birdie":100,"eagle":420,"albatross":800}
  tier_thresholds jsonb not null default '{}'::jsonb
    check (jsonb_typeof(tier_thresholds) = 'object'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists league_seasons_active_idx
  on public.league_seasons (is_active);

create table if not exists public.user_league_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.league_seasons (id) on delete cascade,
  tier text not null default 'bogey',
  points integer not null default 0 check (points >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, season_id)
);

create index if not exists user_league_progress_season_points_idx
  on public.user_league_progress (season_id, points desc);

-- RLS
alter table public.challenges enable row level security;
alter table public.user_challenges enable row level security;
alter table public.league_seasons enable row level security;
alter table public.user_league_progress enable row level security;

drop policy if exists "challenges_select_authenticated" on public.challenges;
create policy "challenges_select_authenticated"
  on public.challenges for select to authenticated
  using (true);

drop policy if exists "user_challenges_select_own" on public.user_challenges;
create policy "user_challenges_select_own"
  on public.user_challenges for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_challenges_insert_own" on public.user_challenges;
create policy "user_challenges_insert_own"
  on public.user_challenges for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_challenges_update_own" on public.user_challenges;
create policy "user_challenges_update_own"
  on public.user_challenges for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "league_seasons_select_authenticated" on public.league_seasons;
create policy "league_seasons_select_authenticated"
  on public.league_seasons for select to authenticated
  using (true);

drop policy if exists "user_league_progress_select_own" on public.user_league_progress;
create policy "user_league_progress_select_own"
  on public.user_league_progress for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_league_progress_insert_own" on public.user_league_progress;
create policy "user_league_progress_insert_own"
  on public.user_league_progress for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_league_progress_update_own" on public.user_league_progress;
create policy "user_league_progress_update_own"
  on public.user_league_progress for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 글로벌 랭킹 (친구 그래프 없음). 최신 리포트 점수 기준.
create or replace function public.get_global_leaderboard(limit_count integer default 20)
returns table (
  rank bigint,
  user_id uuid,
  display_name text,
  score numeric,
  rank_delta integer
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (r.user_id)
      r.user_id,
      r.overall_score,
      r.created_at
    from public.swing_reports r
    order by r.user_id, r.created_at desc
  ),
  ranked as (
    select
      l.user_id,
      coalesce(nullif(trim(u.name), ''), '골퍼') as display_name,
      l.overall_score as score,
      row_number() over (
        order by l.overall_score desc, l.created_at asc
      ) as rank
    from latest l
    left join public.users u on u.id = l.user_id
  )
  select
    ranked.rank,
    ranked.user_id,
    ranked.display_name,
    ranked.score,
    null::integer as rank_delta
  from ranked
  order by ranked.rank
  limit greatest(1, least(coalesce(limit_count, 20), 100));
$$;

revoke all on function public.get_global_leaderboard(integer) from public;
grant execute on function public.get_global_leaderboard(integer) to authenticated;

-- 미션별 참가자 수 (타 유저 RLS 우회용 집계만)
create or replace function public.get_challenge_participant_counts()
returns table (
  challenge_id uuid,
  participant_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select uc.challenge_id, count(*)::bigint as participant_count
  from public.user_challenges uc
  group by uc.challenge_id;
$$;

revoke all on function public.get_challenge_participant_counts() from public;
grant execute on function public.get_challenge_participant_counts() to authenticated;
