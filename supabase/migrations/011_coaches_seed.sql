-- Optional seed coaches for local/dev (run after 008).
-- auth_user_id 는 실제 코치 Auth UID 로 나중에 연결.

insert into public.coaches (
  name, bio, rating, review_count, avg_response_hours, price_krw, specialties, is_active
) values
  (
    '김프로',
    '다운스윙·힙 리드 교정에 강점이 있어요.',
    4.9,
    128,
    6,
    5900,
    array['over_the_top', 'early_extension'],
    true
  ),
  (
    '이코치',
    '임팩트 체중 이동과 리듬을 차분히 봐 드려요.',
    4.7,
    86,
    12,
    4900,
    array['impact_weight_shift', 'overall_good'],
    true
  ),
  (
    '박티처',
    '얼리 익스텐션·자세 각 유지 컨디셔닝 전문.',
    4.8,
    64,
    8,
    5500,
    array['early_extension'],
    true
  )
on conflict do nothing;
