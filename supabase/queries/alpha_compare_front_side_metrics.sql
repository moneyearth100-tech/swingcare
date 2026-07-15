-- 알파 검증용: 정면(front) vs 측면(side) 세션의 관절각도·체중이동 비교
-- Supabase SQL Editor 또는 psql에서 실행.
-- 목적: "참고용" 배지 해제 여부 판단 전 수치 분포 확인.

-- 1) 각도별 세션·리포트 건수
select
  coalesce(s.camera_angle, 'unknown') as camera_angle,
  count(*) as session_count,
  count(r.session_id) as report_count
from public.swing_sessions s
left join public.swing_reports r on r.session_id = s.id
where s.status = 'done'
group by 1
order by 1;

-- 2) 체중이동·머리이동 — 각도별 평균/중앙값(근사: percentile)
select
  coalesce(s.camera_angle, 'unknown') as camera_angle,
  count(*) as n,
  round(avg((r.movement_metrics->>'weightShiftDelta')::numeric)::numeric, 4)
    as avg_weight_shift,
  round(
    percentile_cont(0.5) within group (
      order by (r.movement_metrics->>'weightShiftDelta')::numeric
    )::numeric,
    4
  ) as median_weight_shift,
  round(avg((r.movement_metrics->>'headRiseDelta')::numeric)::numeric, 4)
    as avg_head_rise,
  round(
    percentile_cont(0.5) within group (
      order by (r.movement_metrics->>'headRiseDelta')::numeric
    )::numeric,
    4
  ) as median_head_rise,
  round(
    avg((r.movement_metrics->>'weightShiftSigned')::numeric)::numeric,
    4
  ) as avg_weight_shift_signed
from public.swing_sessions s
join public.swing_reports r on r.session_id = s.id
where s.status = 'done'
  and r.movement_metrics is not null
  and r.movement_metrics ? 'weightShiftDelta'
group by 1
order by 1;

-- 3) 관절 점수 5키 — 각도별 평균
select
  coalesce(s.camera_angle, 'unknown') as camera_angle,
  count(*) as n,
  round(avg((r.joint_scores->>'lower_back')::numeric)::numeric, 1) as avg_lower_back,
  round(avg((r.joint_scores->>'wrist')::numeric)::numeric, 1) as avg_wrist,
  round(avg((r.joint_scores->>'knee')::numeric)::numeric, 1) as avg_knee,
  round(avg((r.joint_scores->>'shoulder')::numeric)::numeric, 1) as avg_shoulder,
  round(avg((r.joint_scores->>'hip')::numeric)::numeric, 1) as avg_hip,
  round(avg(r.overall_score)::numeric, 1) as avg_overall
from public.swing_sessions s
join public.swing_reports r on r.session_id = s.id
where s.status = 'done'
  and r.joint_scores is not null
group by 1
order by 1;

-- 4) 동일 유저의 정면·측면 페어 비교 (같은 날 ±1일 윈도우)
with front_s as (
  select
    s.user_id,
    s.id as session_id,
    s.created_at,
    r.movement_metrics,
    r.joint_scores,
    r.overall_score
  from public.swing_sessions s
  join public.swing_reports r on r.session_id = s.id
  where s.camera_angle = 'front' and s.status = 'done'
),
side_s as (
  select
    s.user_id,
    s.id as session_id,
    s.created_at,
    r.movement_metrics,
    r.joint_scores,
    r.overall_score
  from public.swing_sessions s
  join public.swing_reports r on r.session_id = s.id
  where s.camera_angle = 'side' and s.status = 'done'
)
select
  f.user_id,
  f.session_id as front_session,
  si.session_id as side_session,
  (f.movement_metrics->>'weightShiftDelta')::numeric as front_ws,
  (si.movement_metrics->>'weightShiftDelta')::numeric as side_ws,
  (f.joint_scores->>'hip')::numeric as front_hip,
  (si.joint_scores->>'hip')::numeric as side_hip,
  f.overall_score as front_overall,
  si.overall_score as side_overall,
  abs(extract(epoch from (f.created_at - si.created_at))) / 3600.0
    as hours_apart
from front_s f
join side_s si
  on si.user_id = f.user_id
 and abs(extract(epoch from (f.created_at - si.created_at))) <= 86400
order by hours_apart
limit 100;

-- 5) dominant_hand 유무별 체중이동 방향성 채움률
select
  coalesce(u.dominant_hand, 'unset') as dominant_hand,
  count(*) as report_count,
  count(r.movement_metrics->>'weightShiftTowardTarget') as toward_target_filled,
  count(*) filter (
    where (r.movement_metrics->>'weightShiftTowardTarget')::boolean is true
  ) as toward_target_true
from public.swing_reports r
join public.users u on u.id = r.user_id
where r.movement_metrics is not null
group by 1
order by 1;
