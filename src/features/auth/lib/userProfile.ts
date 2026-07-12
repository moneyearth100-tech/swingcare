/**
 * public.users 프로필 조회·저장.
 */

import { getSupabaseClient } from '../../../services/supabase/client';

import {
  isProfileComplete,
  type InjuryHistoryCode,
  type UserProfile,
  type UserProfileInput,
} from './profileTypes';

function parseInjuryHistory(value: unknown): InjuryHistoryCode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is InjuryHistoryCode => typeof item === 'string',
  );
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
    console.warn('[users] ensure insert failed', insertError.message);
    return null;
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
    .select(
      'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
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
  const payload = {
    id: userId,
    age_group: input.age_group,
    injury_history: input.injury_history,
    handicap: input.handicap,
    profile_completed_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, { onConflict: 'id' })
    .select(
      'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at',
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? '프로필 저장에 실패했습니다.');
  }

  const profile = mapRow(data as Record<string, unknown>);
  if (!isProfileComplete(profile)) {
    throw new Error('프로필 완료 상태를 확인하지 못했습니다.');
  }
  return profile;
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
  const { data, error } = await supabase
    .from('users')
    .update({
      labeling_data_consent_at: now,
      updated_at: now,
    })
    .eq('id', userId)
    .select(
      'id, name, age_group, injury_history, handicap, profile_completed_at, labeling_data_consent_at, created_at, updated_at',
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? '동의 저장에 실패했습니다.');
  }
  return mapRow(data as Record<string, unknown>);
}
