-- Seed for challenges + active league season (005 schema 이후 실행)
-- 고정 UUID로 재실행 시 on conflict 가능

insert into public.challenges (
  id,
  title,
  type,
  duration_days,
  badge_id,
  goal_count,
  target_issue,
  description,
  is_active
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '오버더탑 3일 극복 챌린지',
    'mission',
    3,
    'badge_ott_3day',
    3,
    'over_the_top',
    '완료 시 뱃지 지급',
    true
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '얼리 익스텐션 극복 챌린지',
    'mission',
    5,
    'badge_ee_5day',
    5,
    'early_extension',
    '참가 후 세션을 저장하면 진행도가 올라가요',
    true
  )
on conflict (id) do update set
  title = excluded.title,
  type = excluded.type,
  duration_days = excluded.duration_days,
  badge_id = excluded.badge_id,
  goal_count = excluded.goal_count,
  target_issue = excluded.target_issue,
  description = excluded.description,
  is_active = excluded.is_active;

-- 활성 시즌 1개 (목업: 버디→이글 320P 구간이 보이도록 birdie=100, eagle=420)
update public.league_seasons set is_active = false where is_active = true;

insert into public.league_seasons (
  id,
  name,
  start_at,
  end_at,
  tier_thresholds,
  is_active
)
values (
  'b1000000-0000-4000-8000-000000000001',
  '2026 S1',
  timestamptz '2026-01-01 00:00:00+09',
  timestamptz '2026-12-31 23:59:59+09',
  '{"bogey":0,"birdie":100,"eagle":420,"albatross":800}'::jsonb,
  true
)
on conflict (id) do update set
  name = excluded.name,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  tier_thresholds = excluded.tier_thresholds,
  is_active = excluded.is_active;
