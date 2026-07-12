-- SwingCare: 라벨링 동의 + 관리자 재태깅(phases_verified)
--
-- phases = AI/규칙 원본 유지
-- phases_verified = 사람이 수정한 정답 (nullable)
-- 채점·진단·리뷰는 phases_verified ?? phases 사용

alter table public.users
  add column if not exists labeling_data_consent_at timestamptz;

comment on column public.users.labeling_data_consent_at is
  '촬영 영상 서버 저장·라벨링·모델 개선·필요 시 제3자(위탁) 제공 동의 시각';

alter table public.swing_sessions
  add column if not exists phases_verified jsonb,
  add column if not exists phases_verified_at timestamptz,
  add column if not exists phases_verified_by text;

comment on column public.swing_sessions.phases is
  'AI/규칙 기반 원본 PhaseMarker[]. 재태깅 시에도 덮어쓰지 않음';

comment on column public.swing_sessions.phases_verified is
  '관리자/라벨러가 수정한 정답 PhaseMarker[]. null이면 phases 사용';

comment on column public.swing_sessions.phases_verified_at is
  'phases_verified 저장 시각';

comment on column public.swing_sessions.phases_verified_by is
  '검수자 식별자 (이메일·admin id 등)';
