-- swing_reports.overall_score 는 앱 채점·랭킹에서 0~100을 전제로 함.
-- 기존 이상치 없음 확인 후 CHECK 추가.

alter table public.swing_reports
  drop constraint if exists swing_reports_overall_score_range;

alter table public.swing_reports
  add constraint swing_reports_overall_score_range
  check (overall_score >= 0 and overall_score <= 100);
