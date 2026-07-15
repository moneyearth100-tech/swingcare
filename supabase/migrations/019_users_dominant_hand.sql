-- 좌타/우타 프로필 (선택 입력 — 필수 아님)
--
-- 값 의미:
--   right = 우타 (오른손 타격)
--   left  = 좌타 (왼손 타격)
--   null  = 미입력 — 체중이동 방향성·트레일 손목 우선 표시 생략 (기존 동작)
--
-- camera_angle(swing_sessions)은 014에서 이미 존재 (front | side | unknown).
-- 용어 통일: side = "측면" (공이 나아갈 방향 뒤에서 촬영).

alter table public.users
  add column if not exists dominant_hand text
    check (
      dominant_hand is null
      or dominant_hand in ('right', 'left')
    );

comment on column public.users.dominant_hand is
  '타격 손. right=우타, left=좌타, null=미입력(방향성·트레일 손목 우선표시 생략)';

comment on column public.swing_sessions.camera_angle is
  '촬영 각도. front=정면(마주보기), side=측면(공이 나아갈 방향 뒤), unknown=미확인';
