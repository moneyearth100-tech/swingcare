/** 신체·이력 프로필 도메인 타입 (public.users) */

export type AgeGroup = '20s' | '30s' | '40s' | '50s' | '60_plus';

export type InjuryHistoryCode =
  | 'lower_back'
  | 'wrist'
  | 'shoulder'
  | 'knee'
  | 'none';

export const AGE_GROUP_OPTIONS: { id: AgeGroup; label: string }[] = [
  { id: '20s', label: '20대' },
  { id: '30s', label: '30대' },
  { id: '40s', label: '40대' },
  { id: '50s', label: '50대' },
  { id: '60_plus', label: '60대 이상' },
];

export const INJURY_HISTORY_OPTIONS: {
  id: InjuryHistoryCode;
  label: string;
}[] = [
  { id: 'lower_back', label: '허리' },
  { id: 'wrist', label: '손목' },
  { id: 'shoulder', label: '어깨' },
  { id: 'knee', label: '무릎' },
  { id: 'none', label: '없음' },
];

export const HANDICAP_MIN = 0;
export const HANDICAP_MAX = 54;
export const HANDICAP_DEFAULT = 18;

export interface UserProfile {
  id: string;
  name: string | null;
  age_group: AgeGroup | null;
  injury_history: InjuryHistoryCode[];
  handicap: number | null;
  profile_completed_at: string | null;
  /** 영상 라벨링·모델 개선·제3자 위탁 동의 시각 */
  labeling_data_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfileInput {
  age_group: AgeGroup;
  injury_history: InjuryHistoryCode[];
  handicap: number;
}

export function isProfileComplete(
  profile: Pick<UserProfile, 'profile_completed_at'> | null | undefined,
): boolean {
  return profile?.profile_completed_at != null;
}

export function toggleInjurySelection(
  current: InjuryHistoryCode[],
  tapped: InjuryHistoryCode,
): InjuryHistoryCode[] {
  if (tapped === 'none') {
    return current.includes('none') ? [] : ['none'];
  }
  const withoutNone = current.filter((c) => c !== 'none');
  if (withoutNone.includes(tapped)) {
    return withoutNone.filter((c) => c !== tapped);
  }
  return [...withoutNone, tapped];
}
