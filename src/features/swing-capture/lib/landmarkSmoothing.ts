/** 랜드마크 지터 완화(이동평균) 유틸 — 표시용. 원본 프레임은 별도 유지 */

import type { Landmark, PoseLandmarks } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT } from './landmarkTypes';

/** 이동평균 윈도우 크기 (프레임 수) */
export const SMOOTHING_WINDOW_SIZE = 5;

/**
 * 최근 N프레임의 좌표 이동평균.
 * visibility는 최신 프레임 값을 유지한다 (평균하면 신뢰도 의미가 흐려짐).
 */
export function smoothLandmarks(
  history: readonly PoseLandmarks[],
): PoseLandmarks | null {
  if (history.length === 0) {
    return null;
  }

  const latest = history[history.length - 1];
  if (history.length === 1) {
    return latest.map((point) => ({ ...point }));
  }

  const count = Math.min(BLAZEPOSE_LANDMARK_COUNT, latest.length);
  const smoothed: Landmark[] = [];

  for (let i = 0; i < count; i += 1) {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let samples = 0;

    for (const frame of history) {
      const point = frame[i];
      if (!point) {
        continue;
      }
      sumX += point.x;
      sumY += point.y;
      sumZ += point.z;
      samples += 1;
    }

    const fallback = latest[i];
    if (samples === 0 || !fallback) {
      continue;
    }

    smoothed.push({
      x: sumX / samples,
      y: sumY / samples,
      z: sumZ / samples,
      visibility: fallback.visibility,
    });
  }

  return smoothed;
}

/** 히스토리에 프레임을 넣고 윈도우 크기를 유지한 새 배열을 반환 */
export function pushLandmarkHistory(
  history: readonly PoseLandmarks[],
  next: PoseLandmarks,
  windowSize: number = SMOOTHING_WINDOW_SIZE,
): PoseLandmarks[] {
  const updated = [...history, next];
  if (updated.length <= windowSize) {
    return updated;
  }
  return updated.slice(updated.length - windowSize);
}
