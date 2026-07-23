/**
 * public.users 프로필 조회·저장.
 */

import { getSupabaseClient } from '../../../services/supabase/client';

import {
  isProfileComplete,
  type DominantHand,
  type InjuryHistoryCode,
  type UserProfile,
  type UserProfileInput,
} from './profileTypes';

const PROFILE_SELECT =
  'id, name, age_group, injury_history, handicap, dominant_hand, profile_completed_at, labeling_data_consent_at, created_at, updated_at';

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

/** 없으면 행 생성 후 반환 (트리거 미적용 환경 대비) */
export async function ensureUserProfileRow(
  userId: string,
): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const existing = await fetchUserProfile(userId);
  if (existing) {
    return existing;
  }

  const { error: insertError } = await supabase.from('users').insert({
    id: userId,
  });
  if (insertError && insertError.code !== '23505') {
    // 트리거가 거의 동시에 만든 경우 등 — upsert 로 한 번 더 보장
    const { error: upsertError } = await supabase.from('users').upsert(
      { id: userId },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (upsertError) {
      console.warn(
        '[users] ensure insert failed',
        insertError.message,
        upsertError.message,
      );
      return fetchUserProfile(userId);
    }
  }

  return fetchUserProfile(userId);
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
    if (
      error.code === '42703' ||
      error.message.includes('dominant_hand')
    ) {
      const legacy = await supabase
        .from('users')
        .select(
          'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at',
        )
        .eq('id', userId)
        .maybeSingle();
      if (legacy.error || !legacy.data) {
        console.warn('[users] fetch failed', legacy.error?.message ?? error.message);
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

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    id: userId,
    age_group: input.age_group,
    injury_history: input.injury_history,
    handicap: input.handicap,
    profile_completed_at: now,
    updated_at: now,
  };
  if (input.dominant_hand !== undefined) {
    payload.dominant_hand = input.dominant_hand;
  }

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'id' })
    .select(PROFILE_SELECT)
    .single();

  if (error || !data) {
    // dominant_hand 컬럼 없으면 해당 필드 제외 재시도
    if (
      error &&
      (error.code === '42703' || error.message.includes('dominant_hand'))
    ) {
      const { dominant_hand: _omit, ...rest } = payload;
      const retry = await supabase
        .from('users')
        .upsert(rest, { onConflict: 'id' })
        .select(
          'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at',
        )
        .single();
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

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .update({
      dominant_hand: dominantHand,
      updated_at: now,
    })
    .eq('id', userId)
    .select(PROFILE_SELECT)
    .single();

  if (error || !data) {
    if (
      error &&
      (error.code === '42703' || error.message.includes('dominant_hand'))
    ) {
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
  userId: string,
): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase 미설정');
  }
  await ensureUserProfileRow(userId);
  const now = new Date().toISOString();

  // update+single 은 행이 없거나 RLS로 0건이면
  // "cannot coerce the result to a single json object" 가 난다.
  // upsert + maybeSingle 로 행 보장.
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        id: userId,
        labeling_data_consent_at: now,
        updated_at: now,
      },
      { onConflict: 'id' },
    )
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error) {
    if (
      error.code === '42703' ||
      error.message.includes('dominant_hand')
    ) {
      const retry = await supabase
        .from('users')
        .upsert(
          {
            id: userId,
            labeling_data_consent_at: now,
            updated_at: now,
          },
          { onConflict: 'id' },
        )
        .select(
          'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at',
        )
        .maybeSingle();
      if (retry.error || !retry.data) {
        throw new Error(
          retry.error?.message ?? error.message ?? '동의 저장에 실패했습니다.',
        );
      }
      return mapRow({ ...retry.data, dominant_hand: null });
    }
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('동의 저장 후 프로필을 읽지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  return mapRow(data as Record<string, unknown>);
}
