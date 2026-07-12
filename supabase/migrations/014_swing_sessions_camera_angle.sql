-- C. 촬영 각도 (1폰 정면 가이드 → 이후 듀얼폰 정면+후면 재사용 전제)
--
-- 값 의미 (앱 UI 카피: "정면" / "후면")
--   front   = 정면 — 어드레스하는 골퍼를 마주보는 각도 (face-on)
--   side    = 예약값 — 현재 1폰은 미사용. 후면(공이 나아갈 방향 뒤쪽) 후보였으나
--             듀얼폰 시 'down_the_line' 등 더 명확한 값으로 교체 검토
--   unknown = 기본 / 각도 미기록·미확인
--
-- 1폰: 가이드를 따른 뒤 저장 시 'front' 기록 (실시간 각도 검증 없음)

alter table public.swing_sessions
  add column if not exists camera_angle text not null default 'unknown'
    check (camera_angle in ('front', 'side', 'unknown'));

comment on column public.swing_sessions.camera_angle is
  '촬영 각도. front=정면(마주보기), side=예약(후면 후보·확장 검토), unknown=미확인';
