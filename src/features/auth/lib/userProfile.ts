/**
 * public.users 프로필 조회·저장.
 */

import {
  getSupabaseClient,
  requireAuthenticatedUserId,
} from '../../../services/supabase/client';

import {
  isProfileComplete,
  type DominantHand,
  type InjuryHistoryCode,
  type UserProfile,
  type UserProfileInput,
} from './profileTypes';

const PROFILE_SELECT =
  'id, name, age_group, injury_history, handicap, dominant_hand, profile_completed_at, labeling_data_consent_at, created_at, updated_at';

const PROFILE_SELECT_LEGACY =
  'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at';

function parseInjuryHistory(value: unknown): InjuryHistoryCode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is InjuryHistoryCode => typeof item === 'string',
  );
}

function parseDominantHand(value: unknown): DominantHand | null {
  if (value === 'right' || value === 'left') {
    return value;
  }
  return null;
}

function mapRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    age_group: (row.age_group as UserProfile['age_group']) ?? null,
    injury_history: parseInjuryHistory(row.injury_history),
    handicap:
      row.handicap == null || row.handicap === ''
        ? null
        : Number(row.handicap),
    dominant_hand: parseDominantHand(row.dominant_hand),
    profile_completed_at: (row.profile_completed_at as string | null) ?? null,
    labeling_data_consent_at:
      (row.labeling_data_consent_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function isMissingColumnError(error: { code?: string; message: string }): boolean {
  return (
    error.code === '42703' ||
    error.message.includes('dominant_hand') ||
    error.message.includes('does not exist')
  );
}

function isRlsError(error: { code?: string; message: string }): boolean {
  const msg = error.message.toLowerCase();
  return (
    error.code === '42501' ||
    msg.includes('row-level security') ||
    msg.includes('rls')
  );
}

function isMissingRpcError(error: { code?: string; message: string }): boolean {
  const msg = error.message.toLowerCase();
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('function public.save_labeling_data_consent') ||
    msg.includes('function public.ensure_own_user_row')
  );
}

/** 없으면 행 생성 후 반환 (트리거 미적용 환경 대비) */
export async function ensureUserProfileRow(
  userId?: string,
): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  let uid = userId;
  try {
    uid = await requireAuthenticatedUserId();
  } catch {
    if (!uid) {
      return null;
    }
  }

  const existing = await fetchUserProfile(uid);
  if (existing) {
    return existing;
  }

  // 1) security definer RPC (RLS INSERT 회피)
  const rpc = await supabase.rpc('ensure_own_user_row');
  if (!rpc.error && rpc.data) {
    return mapRow(rpc.data as Record<string, unknown>);
  }
  if (rpc.error && !isMissingRpcError(rpc.error)) {
    console.warn('[users] ensure_own_user_row', rpc.error.message);
  }

  // 2) 직접 insert (본인 id 만)
  const { error: insertError } = await supabase.from('users').insert({
    id: uid,
  });
  if (insertError && insertError.code !== '23505') {
    console.warn('[users] ensure insert failed', insertError.message);
    return fetchUserProfile(uid);
  }

  return fetchUserProfile(uid);
}

export async function fetchUserProfile(
  userId: string,
): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // 019 마이그레이션 전 환경: dominant_hand 없이 폴백
    if (isMissingColumnError(error)) {
      const legacy = await supabase
        .from('users')
        .select(PROFILE_SELECT_LEGACY)
        .eq('id', userId)
        .maybeSingle();
      if (legacy.error || !legacy.data) {
        console.warn(
          '[users] fetch failed',
          legacy.error?.message ?? error.message,
        );
        return null;
      }
      return mapRow({ ...legacy.data, dominant_hand: null });
    }
    console.warn('[users] fetch failed', error.message);
    return null;
  }
  if (!data) {
    return null;
  }
  return mapRow(data as Record<string, unknown>);
}

export async function saveUserProfile(
  userId: string,
  input: UserProfileInput,
): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase 미설정');
  }

  if (input.injury_history.length === 0) {
    throw new Error('기존 통증·부상 이력을 하나 이상 선택해 주세요.');
  }

  const uid = await requireAuthenticatedUserId();
  if (uid !== userId) {
    throw new Error('로그인 세션이 바뀌었어요. 다시 시도해 주세요.');
  }

  await ensureUserProfileRow(uid);

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    age_group: input.age_group,
    injury_history: input.injury_history,
    handicap: input.handicap,
    profile_completed_at: now,
    updated_at: now,
  };
  if (input.dominant_hand !== undefined) {
    payload.dominant_hand = input.dominant_hand;
  }

  // upsert 대신 update — INSERT WITH CHECK / role 충돌 회피
  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', uid)
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error || !data) {
    if (error && isMissingColumnError(error)) {
      const { dominant_hand: _omit, ...rest } = payload;
      const retry = await supabase
        .from('users')
        .update(rest)
        .eq('id', uid)
        .select(PROFILE_SELECT_LEGACY)
        .maybeSingle();
      if (retry.error || !retry.data) {
        throw new Error(
          retry.error?.message ?? error.message ?? '프로필 저장에 실패했습니다.',
        );
      }
      return mapRow({ ...retry.data, dominant_hand: null });
    }
    throw new Error(error?.message ?? '프로필 저장에 실패했습니다.');
  }

  const profile = mapRow(data as Record<string, unknown>);
  if (!isProfileComplete(profile)) {
    throw new Error('프로필 완료 상태를 확인하지 못했습니다.');
  }
  return profile;
}

/** 주손방향만 부분 갱신 (null = 미선택, 기존 스코어링 유지) */
export async function updateDominantHand(
  userId: string,
  dominantHand: DominantHand | null,
): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase 미설정');
  }

  const uid = await requireAuthenticatedUserId();
  if (uid !== userId) {
    throw new Error('로그인 세션이 바뀌었어요. 다시 시도해 주세요.');
  }

  await ensureUserProfileRow(uid);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .update({
      dominant_hand: dominantHand,
      updated_at: now,
    })
    .eq('id', uid)
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error || !data) {
    if (error && isMissingColumnError(error)) {
      throw new Error(
        '주손방향 저장을 위해 dominant_hand 마이그레이션이 필요합니다.',
      );
    }
    throw new Error(error?.message ?? '주손방향 저장에 실패했습니다.');
  }

  return mapRow(data as Record<string, unknown>);
}

/** 촬영 영상 라벨링·모델 개선·제3자 위탁 동의 기록 */
export async function saveLabelingDataConsent(
  _userId?: string,
): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase 미설정');
  }

  // 호출자 userId 보다 실제 JWT 의 uid 를 우선 — RLS 불일치 방지
  const uid = await requireAuthenticatedUserId();

  // 1) security definer RPC (권장 경로)
  const rpc = await supabase.rpc('save_labeling_data_consent');
  if (!rpc.error && rpc.data) {
    return mapRow(rpc.data as Record<string, unknown>);
  }
  if (rpc.error && !isMissingRpcError(rpc.error)) {
    // RPC 는 있는데 실패 → 폴백 전에 원인 로그
    console.warn('[users] save_labeling_data_consent rpc', rpc.error.message);
    if (isRlsError(rpc.error) || rpc.error.message.includes('not authenticated')) {
      throw new Error(
        '로그인 세션이 만료됐어요. 앱을 다시 실행한 뒤 동의해 주세요.',
      );
    }
    // RPC 실패여도 아래 update 폴백 시도
  }

  // 2) 행 보장 후 update only (upsert INSERT 회피)
  await ensureUserProfileRow(uid);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .update({
      labeling_data_consent_at: now,
      updated_at: now,
    })
    .eq('id', uid)
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      const retry = await supabase
        .from('users')
        .update({
          labeling_data_consent_at: now,
          updated_at: now,
        })
        .eq('id', uid)
        .select(PROFILE_SELECT_LEGACY)
        .maybeSingle();
      if (retry.error || !retry.data) {
        throw new Error(
          retry.error?.message ?? error.message ?? '동의 저장에 실패했습니다.',
        );
      }
      return mapRow({ ...retry.data, dominant_hand: null });
    }
    if (isRlsError(error)) {
      throw new Error(
        '동의 저장 권한이 없어요. 앱을 다시 실행한 뒤 시도해 주세요.',
      );
    }
    throw new Error(error.message);
  }
  if (!data) {
    // update 0건 → 행이 여전히 없음. insert 한 번 더 시도 후 update
    const { error: insertError } = await supabase.from('users').insert({
      id: uid,
      labeling_data_consent_at: now,
      updated_at: now,
    });
    if (insertError && insertError.code !== '23505') {
      if (isRlsError(insertError)) {
        throw new Error(
          '동의 저장 권한이 없어요. 서버 프로필 생성이 막혀 있어요. 잠시 후 다시 시도해 주세요.',
        );
      }
      throw new Error(insertError.message);
    }
    const again = await fetchUserProfile(uid);
    if (!again?.labeling_data_consent_at) {
      const second = await supabase
        .from('users')
        .update({
          labeling_data_consent_at: now,
          updated_at: now,
        })
        .eq('id', uid)
        .select(PROFILE_SELECT)
        .maybeSingle();
      if (second.error || !second.data) {
        throw new Error(
          second.error?.message ??
            '동의 저장 후 프로필을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
      }
      return mapRow(second.data as Record<string, unknown>);
    }
    return again;
  }
  return mapRow(data as Record<string, unknown>);
}
