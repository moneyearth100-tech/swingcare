-- SwingCare: upload 세션용 컬럼 + Storage 버킷
--
-- NOTE (5.4절 예외):
--   실시간(live) 캡처는 랜드마크 좌표만 저장하고 video_url = null 이다.
--   업로드(upload) 영상은 서버가 나중에 분석해야 하므로 원본을 Storage에 두고
--   video_url을 swing_sessions에 저장한다. "영상 저장 안 함" 원칙은 live에만 적용.
--
-- 자동 삭제(Storage lifecycle / N일 cron)는 이번 마이그레이션 범위 밖.
-- delete 정책은 사용자 본인 수동 삭제용으로만 열어 둔다.

alter table public.swing_sessions
  add column if not exists capture_mode text not null default 'live'
    check (capture_mode in ('live', 'upload')),
  add column if not exists video_url text,
  add column if not exists status text not null default 'done'
    check (status in ('pending', 'processing', 'done'));

comment on column public.swing_sessions.capture_mode is
  'live = 온디바이스 좌표만 / upload = 원본 영상 보관 후 서버 분석';

comment on column public.swing_sessions.video_url is
  'upload 전용. live는 null (5.4 영상 미저장). upload는 서버 분석용 원본 경로';

comment on column public.swing_sessions.status is
  'upload 직후 pending. 서버 파이프라인 없으면 pending 유지가 정상';

-- Private bucket for uploaded swing videos (path: {user_id}/...)
insert into storage.buckets (id, name, public)
values ('swing-uploads', 'swing-uploads', false)
on conflict (id) do nothing;

-- storage.objects RLS: 본인 폴더만 (수동 삭제 포함). lifecycle 자동삭제는 추후.

create policy "swing_uploads_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'swing-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "swing_uploads_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'swing-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "swing_uploads_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'swing-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "swing_uploads_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'swing-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
