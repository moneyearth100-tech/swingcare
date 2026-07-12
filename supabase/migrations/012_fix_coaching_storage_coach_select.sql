-- Fix: 008 코치 Storage SELECT 정책의 name 컬럼 모호성
-- EXISTS 서브쿼리 안에서 미한정 name 이 coaches.name(표시 이름)으로 해석되어
-- 경로 매칭이 항상 실패 → createSignedUrl "Object not found"
-- 해결: storage.objects.name 으로 명시

drop policy if exists "swing_coaching_select_assigned_coach" on storage.objects;
create policy "swing_coaching_select_assigned_coach"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'swing-coaching'
    and exists (
      select 1
      from public.coaching_requests cr
      join public.coaches c on c.id = cr.coach_id
      where c.auth_user_id = auth.uid()
        and cr.user_id::text = (storage.foldername(storage.objects.name))[1]
        and cr.id::text = split_part(storage.filename(storage.objects.name), '.', 1)
    )
  );
