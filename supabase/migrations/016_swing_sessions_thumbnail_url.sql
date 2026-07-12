-- 실시간 촬영 썸네일 (카메라 한 컷). 영상(video_url)과 별도.

alter table public.swing_sessions
  add column if not exists thumbnail_url text;

comment on column public.swing_sessions.thumbnail_url is
  '스윙 썸네일 Storage 경로 (예: swing-uploads/{user}/{session}_thumb.jpg). 실시간 녹화 종료 시 카메라 한 컷.';
