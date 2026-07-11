/**
 * 포즈 "사람 있음" 판별 — 렌즈 가림/노이즈와 저조도를 구분.
 * iOS는 렌즈를 가려도 landmarks[]가 비지 않고 낮은 visibility로 계속 올 수 있음.
 */

import {
  LANDMARK_INDEX,
  type PoseLandmarks,
} from './landmarkTypes';
import { averageVisibility } from './normalizeLandmarkEvent';

/** 몸통 핵심 관절 — 사람 존재 여부 판단용 */
const CORE_LANDMARK_INDICES = [
  LANDMARK_INDEX.left_shoulder,
  LANDMARK_INDEX.right_shoulder,
  LANDMARK_INDEX.left_hip,
  LANDMARK_INDEX.right_hip,
] as const;

/** 핵심 관절 평균이 이 미만이면 미인식(각도 배너) */
export const PERSON_PRESENT_CORE_VISIBILITY = 0.5;

/**
 * 전체 평균이 이 미만이면 미인식.
 * 렌즈 가림 시 iOS가 0.25~0.45 대역 랜드마크를 흘려 저조도로 오인하는 것을 막는다.
 */
export const PERSON_PRESENT_AVG_VISIBILITY = 0.4;

/** 저조도 배너 — 사람은 잡히나 전체 평균이 이 미만 (보통 0.4~0.5) */
export const LOW_LIGHT_AVG_VISIBILITY = 0.5;

export function averageCoreVisibility(
  landmarks: PoseLandmarks | null | undefined,
): number {
  if (!landmarks || landmarks.length === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (const index of CORE_LANDMARK_INDICES) {
    const point = landmarks[index];
    if (!point) {
      continue;
    }
    sum += point.visibility ?? 0;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return sum / count;
}

/**
 * landmarks 비어 있거나, 몸통/전체 visibility가 사람 기준으로 부족하면 미인식.
 * → 2초 지속 시 "카메라 각도를 조정해주세요"
 */
export function isPoseEffectivelyAbsent(
  landmarks: PoseLandmarks | null | undefined,
  avgVisibilityOverride?: number,
): boolean {
  if (!landmarks || landmarks.length === 0) {
    return true;
  }
  const core = averageCoreVisibility(landmarks);
  if (core < PERSON_PRESENT_CORE_VISIBILITY) {
    return true;
  }
  const avg =
    avgVisibilityOverride ?? averageVisibility(landmarks);
  if (avg < PERSON_PRESENT_AVG_VISIBILITY) {
    return true;
  }
  return false;
}
