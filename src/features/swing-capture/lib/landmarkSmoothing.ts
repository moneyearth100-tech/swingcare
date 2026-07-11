/** 랜드마크 지터 완화 유틸 — 표시용. 원본 프레임은 별도 유지 */

import type { Landmark, PoseLandmarks } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT } from './landmarkTypes';

/**
 * 문서 권장 이동평균 윈도우(3~5)에 대응하는 참고값.
 * 실제 표시 경로는 시간 기반 EMA(`smoothLandmarksEma`)를 쓴다.
 */
export const SMOOTHING_WINDOW_SIZE = 5;

/**
 * 시간 상수 τ (ms). α = 1 - exp(-dt / TAU).
 * 클수록 더 부드럽고 지연↑, 작을수록 원본에 가깝고 반응↑.
 *
 * Android는 thinksys Gson 문자열 브릿지 등 파이프라인 지연이 있어
 * 동일 τ면 iOS보다 한 박자 늦게 느껴지므로 τ를 낮춰 보정한다.
 * (시간 기반 EMA는 JS에 도착한 뒤 dt만 보정 — 브릿지 지연 자체는 못 지움)
 */
export const SMOOTHING_EMA_TAU_MS_IOS = 80;
/** Android: 브릿지 지연 보정. 체감 반박자 남으면 더 낮출 것 */
export const SMOOTHING_EMA_TAU_MS_ANDROID = 35;

/** @deprecated 기본값 참고용 — 플랫폼별 상수를 쓰세요 */
export const SMOOTHING_EMA_TAU_MS = SMOOTHING_EMA_TAU_MS_IOS;

/**
 * 이 이상 dt가 벌어지면 스무딩하지 않고 새 프레임으로 스냅
 * (포즈 소실·앱 전환 등 — 큰 갭을 이어 붙이면 부자연스러운 슬라이딩).
 */
export const SMOOTHING_EMA_SNAP_DT_MS = 300;

/** @deprecated 고정 α 레거시. 시간 기반 EMA는 TAU를 사용한다. */
export const SMOOTHING_EMA_ALPHA = 0.5;

/**
 * dt(ms)·τ(ms) → EMA 계수. 비정상 dt는 null(스냅 신호).
 */
export function emaAlphaFromDt(
  dtMs: number,
  tauMs: number = SMOOTHING_EMA_TAU_MS,
  snapDtMs: number = SMOOTHING_EMA_SNAP_DT_MS,
): number | null {
  if (!Number.isFinite(dtMs) || dtMs <= 0) {
    return null;
  }
  if (dtMs >= snapDtMs) {
    return null;
  }
  if (!Number.isFinite(tauMs) || tauMs <= 0) {
    return 1;
  }
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return Math.min(1, Math.max(0, alpha));
}

/**
 * 표시용 시간 기반 EMA.
 * - previous 없음 / alpha null(스냅) / alpha≥1 → raw 복사
 * - visibility는 최신(raw) 값 유지
 */
export function smoothLandmarksEma(
  previous: PoseLandmarks | null,
  next: PoseLandmarks,
  alpha: number | null,
): PoseLandmarks {
  if (!previous || previous.length === 0 || alpha == null || alpha >= 1) {
    return next.map((point) => ({ ...point }));
  }

  const a = Math.min(1, Math.max(0, alpha));
  const count = Math.min(BLAZEPOSE_LANDMARK_COUNT, next.length, previous.length);
  const smoothed: Landmark[] = [];
  const inv = 1 - a;

  for (let i = 0; i < count; i += 1) {
    const curr = next[i];
    const prev = previous[i];
    if (!curr) {
      continue;
    }
    if (!prev) {
      smoothed.push({ ...curr });
      continue;
    }
    smoothed.push({
      x: a * curr.x + inv * prev.x,
      y: a * curr.y + inv * prev.y,
      z: a * curr.z + inv * prev.z,
      visibility: curr.visibility,
    });
  }

  return smoothed;
}

/**
 * 최근 N프레임 균등 이동평균 (레거시/테스트용).
 * visibility는 최신 프레임 값을 유지한다.
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
