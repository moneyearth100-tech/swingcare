-- SwingCare: 하이브리드 코칭 마켓 (coaches / coaching_requests + Storage)
--
-- 확정 정책 (2026-07-12 승인):
--
-- 1) status 흐름
--    draft  = AI 클립 추출 완료·사용자 확인 대기 (코치에게 아직 미전송)
--    pending = 사용자가 「코치에게 보내기」를 누른 뒤에만 전환 (수동 트리거)
--    ※ AI가 8초 클립을 뽑아도 draft에 머물며, 사용자 확인 없이 코치에게
--      자동 전송되지 않는다. (엉뚱한 구간 전송 방지)
--
--    draft → pending  → accepted → in_review → completed
--                    ↘ canceled / expired
--
-- 2) price_krw 이중 보관
--    coaches.price_krw          = 코치 현재 기본 단가 (카탈로그)
--    coaching_requests.price_krw = 요청 생성 시점의 coaches.price_krw 스냅샷
--    ※ 이후 코치가 단가를 올려도 과거 요청 기록 가격은 변하지 않는다.
--
-- 3) Storage (swing-coaching)
--    경로 관례: {user_id}/{request_id}.mp4
--    읽기: 요청 소유자(user_id) + 해당 요청에 배정된 coach만
--    (다른 코치는 clip URL을 알아도 접근 불가)
--    쓰기/갱신/삭제: 요청 소유자만 (클라이언트 업로드·재추출용)
--    코치 계정 식별: public.users 확장 또는 JWT claim 대신
--      coaches.auth_user_id = auth.uid() 매핑을 사용한다.

-- ---------------------------------------------------------------------------
-- coaches
-- ---------------------------------------------------------------------------
create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  -- Supabase Auth 유저(코치 로그인)와 1:1. Storage RLS에서 배정 코치 판별용.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  avatar_url text,
  bio text,
  rating numeric(2, 1) not null default 5.0
    check (rating >= 0 and rating <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  avg_response_hours numeric(5, 1),
  -- 카탈로그 현재 단가 (원)
  price_krw integer not null check (price_krw > 0),
  -- DiagnosisPatternId 등 문제 유형 매칭용
  specialties text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists coaches_active_idx
  on public.coaches (is_active)
  where is_active = true;

create index if not exists coaches_auth_user_idx
  on public.coaches (auth_user_id)
  where auth_user_id is not null;

comment on column public.coaches.price_krw is
  '코치 현재 기본 단가. 요청 생성 시 coaching_requests.price_krw 로 스냅샷 복사';

comment on column public.coaches.auth_user_id is
  '코치 로그인 Auth UID. Storage/RLS에서 배정 코치 읽기 권한에 사용';

comment on column public.coaches.specialties is
  '매칭용 문제 유형 배열 (예: over_the_top). DiagnosisPatternId 와 동일 문자열 권장';

alter table public.coaches enable row level security;

-- 활성 코치 카탈로그: 로그인 유저 누구나 조회
drop policy if exists "coaches_select_active" on public.coaches;
create policy "coaches_select_active"
  on public.coaches for select to authenticated
  using (is_active = true or auth_user_id = auth.uid());

-- 코치 본인 프로필 수정 (단가·소개 등)
drop policy if exists "coaches_update_own" on public.coaches;
create policy "coaches_update_own"
  on public.coaches for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- coaching_requests
-- ---------------------------------------------------------------------------
create table if not exists public.coaching_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- draft(미리보기) 단계에서는 null 가능. pending 전환 시 필수.
  coach_id uuid references public.coaches (id),
  session_id uuid references public.swing_sessions (id) on delete set null,
  report_id uuid references public.swing_reports (id) on delete set null,

  -- AI 클립 (ffmpeg trim) — Storage 경로 또는 bucket-relative URL
  -- 예: swing-coaching/{user_id}/{request_id}.mp4
  clip_url text,
  clip_start_ms integer not null,
  clip_end_ms integer not null,
  issue_phase text,
  -- 코치 specialties 매칭용 (DiagnosisPatternId). issue_phase(SwingPhase)와 별개.
  diagnosis_pattern_id text,
  diagnosis_summary text,

  -- draft: 클립 준비·사용자 확인 대기 (미전송)
  -- pending: 미리보기에서 「코치에게 보내기」를 누른 뒤에만 (자동 전송 금지)
  status text not null default 'draft'
    check (status in (
      'draft',
      'pending',
      'accepted',
      'in_review',
      'completed',
      'canceled',
      'expired'
    )),

  coach_reply_text text,
  coach_replied_at timestamptz,

  -- 요청 생성 시점 coaches.price_krw 스냅샷 (코치 선택 시 채움, draft 초기에는 null)
  price_krw integer check (price_krw is null or price_krw > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (clip_end_ms > clip_start_ms),
  check (
    status = 'draft'
    or (coach_id is not null and price_krw is not null)
  )
);

create index if not exists coaching_requests_user_created_idx
  on public.coaching_requests (user_id, created_at desc);

create index if not exists coaching_requests_coach_status_idx
  on public.coaching_requests (coach_id, status);

create index if not exists coaching_requests_status_idx
  on public.coaching_requests (status);

comment on column public.coaching_requests.status is
  'draft=클립 추출·미리보기 확인 대기. pending=사용자가 「코치에게 보내기」누른 뒤만. AI 자동 전송 없음';

comment on column public.coaching_requests.price_krw is
  '요청 생성 시점 코치 단가 스냅샷. coaches.price_krw 이후 변경해도 이 값은 유지';

comment on column public.coaching_requests.clip_url is
  'Storage 상대경로 권장: swing-coaching/{user_id}/{id}.mp4';

comment on column public.coaching_requests.diagnosis_pattern_id is
  'DiagnosisPatternId (over_the_top 등). coaches.specialties 우선 정렬에 사용. issue_phase와 혼동 금지';

alter table public.coaching_requests enable row level security;

-- 본인 요청 전체 CRUD
drop policy if exists "coaching_requests_select_own" on public.coaching_requests;
create policy "coaching_requests_select_own"
  on public.coaching_requests for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "coaching_requests_insert_own" on public.coaching_requests;
create policy "coaching_requests_insert_own"
  on public.coaching_requests for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "coaching_requests_update_own" on public.coaching_requests;
create policy "coaching_requests_update_own"
  on public.coaching_requests for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "coaching_requests_delete_own" on public.coaching_requests;
create policy "coaching_requests_delete_own"
  on public.coaching_requests for delete to authenticated
  using (auth.uid() = user_id);

-- 배정된 코치: 본인에게 온 요청만 조회·회신 업데이트
drop policy if exists "coaching_requests_select_assigned_coach" on public.coaching_requests;
create policy "coaching_requests_select_assigned_coach"
  on public.coaching_requests for select to authenticated
  using (
    exists (
      select 1 from public.coaches c
      where c.id = coaching_requests.coach_id
        and c.auth_user_id = auth.uid()
    )
  );

drop policy if exists "coaching_requests_update_assigned_coach" on public.coaching_requests;
create policy "coaching_requests_update_assigned_coach"
  on public.coaching_requests for update to authenticated
  using (
    exists (
      select 1 from public.coaches c
      where c.id = coaching_requests.coach_id
        and c.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.coaches c
      where c.id = coaching_requests.coach_id
        and c.auth_user_id = auth.uid()
    )
  );

-- 코치 UPDATE는 회신·상태·시각만 허용 (가격/클립/소유자 변경 방지)
create or replace function public.coaching_requests_coach_update_guard()
returns trigger
language plpgsql
as $$
declare
  is_assigned_coach boolean;
begin
  select exists (
    select 1 from public.coaches c
    where c.id = old.coach_id and c.auth_user_id = auth.uid()
  ) into is_assigned_coach;

  -- 소유자(user) 업데이트는 제한하지 않음
  if not is_assigned_coach or auth.uid() = old.user_id then
    new.updated_at := now();
    return new;
  end if;

  if new.user_id is distinct from old.user_id
    or new.coach_id is distinct from old.coach_id
    or new.session_id is distinct from old.session_id
    or new.report_id is distinct from old.report_id
    or new.clip_url is distinct from old.clip_url
    or new.clip_start_ms is distinct from old.clip_start_ms
    or new.clip_end_ms is distinct from old.clip_end_ms
    or new.issue_phase is distinct from old.issue_phase
    or new.diagnosis_pattern_id is distinct from old.diagnosis_pattern_id
    or new.diagnosis_summary is distinct from old.diagnosis_summary
    or new.price_krw is distinct from old.price_krw
    or new.created_at is distinct from old.created_at
  then
    raise exception 'assigned coach may only update reply/status fields';
  end if;

  if new.status is distinct from old.status
    and new.status not in ('accepted', 'in_review', 'completed', 'canceled')
  then
    raise exception 'assigned coach cannot set status to %', new.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists coaching_requests_coach_update_guard on public.coaching_requests;
create trigger coaching_requests_coach_update_guard
  before update on public.coaching_requests
  for each row execute function public.coaching_requests_coach_update_guard();

-- ---------------------------------------------------------------------------
-- Storage bucket + policies
-- path: {user_id}/{request_id}.mp4  (bucket = swing-coaching)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'swing-coaching',
  'swing-coaching',
  false,
  104857600, -- 100MB
  array['video/mp4', 'video/quicktime']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 헬퍼: object name 첫 세그먼트 = user_id
-- storage.objects.name 예: "{user_uuid}/{request_uuid}.mp4"

-- 본인: 자기 폴더 CRUD
drop policy if exists "swing_coaching_select_own" on storage.objects;
create policy "swing_coaching_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'swing-coaching'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "swing_coaching_insert_own" on storage.objects;
create policy "swing_coaching_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'swing-coaching'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "swing_coaching_update_own" on storage.objects;
create policy "swing_coaching_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'swing-coaching'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'swing-coaching'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "swing_coaching_delete_own" on storage.objects;
create policy "swing_coaching_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'swing-coaching'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 배정 코치: coaching_requests 에 본인이 coach 로 연결된 객체의 request_id 만 읽기
-- path: {user_id}/{request_id}.mp4 → 파일 stem = request_id
-- NOTE: name 은 coaches.name 과 충돌하므로 storage.objects.name 으로 한정해야 함
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
