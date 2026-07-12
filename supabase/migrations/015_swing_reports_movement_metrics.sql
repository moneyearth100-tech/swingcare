-- A-2 + B. 이동지표·손목 코킹 (scoring_version load_score_v2 부터 채움)
--
-- joint_scores(jsonb)는 스키마 변경 없음 — v2부터 shoulder/hip 키를 앱이 추가 기록.
-- 기존 v1 행은 소급 재계산하지 않음. movement_metrics 는 null 허용.
--
-- 예상 형태 (앱 작성, DB는 jsonb만 검증):
-- {
--   "weightShiftDelta": 0.12,          -- |정규화 수치|, 방향성 없음 (좌우타 미지원)
--   "headRiseDelta": 0.05,             -- |정규화 수치|
--   "leftWristCockingDeg": 88.4,       -- top 시점, visibility 미달 시 null
--   "rightWristCockingDeg": null
-- }

alter table public.swing_reports
  add column if not exists movement_metrics jsonb;

alter table public.swing_reports
  drop constraint if exists swing_reports_movement_metrics_object;

alter table public.swing_reports
  add constraint swing_reports_movement_metrics_object
  check (
    movement_metrics is null
    or jsonb_typeof(movement_metrics) = 'object'
  );

comment on column public.swing_reports.movement_metrics is
  'load_score_v2+: weightShiftDelta, headRiseDelta, left/rightWristCockingDeg. v1은 null';

comment on column public.swing_reports.joint_scores is
  '관절 점수 0~100. v1: lower_back,wrist,knee / v2+: +shoulder,hip';
