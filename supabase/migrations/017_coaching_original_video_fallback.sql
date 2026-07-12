-- ffmpeg/API 미사용 시 coaching_requests.clip_url이 swing-uploads 원본을 가리킬 수 있다.
-- 요청 소유자와 실제 배정된 코치만 해당 원본을 읽도록 제한한다.

drop policy if exists "swing_uploads_select_assigned_coach" on storage.objects;
create policy "swing_uploads_select_assigned_coach"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'swing-uploads'
    and exists (
      select 1
      from public.coaching_requests cr
      join public.coaches c on c.id = cr.coach_id
      where c.auth_user_id = auth.uid()
        and cr.clip_url = 'swing-uploads/' || storage.objects.name
    )
  );

-- 30초 원본이 trim 결과보다 클 수 있으므로 기존 업로드 상한(200MB)에 맞춘다.
update storage.buckets
set file_size_limit = 209715200,
    allowed_mime_types = array['video/mp4', 'video/quicktime']::text[]
where id = 'swing-coaching';
