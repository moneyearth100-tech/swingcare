/**
 * 규칙 기반 8단계 스윙 구간 분할 순수 함수 (GolfDB 체계).
 *
 * ⚠️ PLACEHOLDER: 손목 y·속도로 근사하는 MVP. 학습 분류기(SwingNet 등)로 교체 예정.
 * 입력/출력 인터페이스(LandmarkFrame[] → PhaseMarker[])만 유지하면 내부 교체 가능.
 */

import type {
  LandmarkFrame,
  PhaseMarker,
  SwingPhase,
} from './landmarkTypes';
import { LANDMARK_INDEX } from './landmarkTypes';
import { trailWristIndexForDominantHand } from './scoring/movementMetrics';
import type { DominantHand } from './scoring/movementMetrics';

/**
 * 트레일 손목 인덱스.
 * 실기기 검증: 오른손 들기 → right_wrist(16) 반응 확인됨 (우타 가정 MVP).
 * 좌타는 trailWristIndexForDominantHand / options.trailWristIndex 로 교체.
 */
export const DEFAULT_TRAIL_WRIST_INDEX = LANDMARK_INDEX.right_wrist;

/** finish: 절대 하한 (정규화 좌표/프레임). 지터보다 약간 위 */
export const FINISH_VELOCITY_FLOOR = 0.025;

/**
 * finish: impact 피크 속도 대비 비율.
 * 고정 임계값(0.012)은 실기기 지터에 막혀 거의 항상 폴백됐음.
 */
export const FINISH_VELOCITY_PEAK_RATIO = 0.22;

/** finish 안정 프레임 수 */
export const FINISH_STABLE_FRAME_COUNT = 3;

/** soft finish: impact 이후 이 비율만큼 지난 뒤부터 최저 속도 구간 탐색 */
export const FINISH_SOFT_SEARCH_START_RATIO = 0.25;

/** top 탐지 시 address 직후 스킵할 최소 프레임 (노이즈) */
export const TOP_SEARCH_MIN_OFFSET_FRAMES = 3;

/** impact 탐지 시 top 직후 스킵할 최소 프레임 */
export const IMPACT_SEARCH_MIN_OFFSET_FRAMES = 2;

/** 손목 좌표·속도에서 단일 프레임 포즈 지터를 줄이는 반경 */
export const WRIST_SMOOTHING_RADIUS_FRAMES = 1;

/** 속도 임계값을 이 기준 프레임 간격으로 환산해 분석 FPS 영향을 줄인다. */
export const VELOCITY_REFERENCE_INTERVAL_MS = 1000 / 15;

export interface SegmentSwingPhasesOptions {
  /** 기본 right_wrist(16). 좌타 등이면 left_wrist 등으로 교체 */
  trailWristIndex?: number;
  /** dominant_hand 넘기면 trailWristIndex 미지정 시 자동 매핑 */
  dominantHand?: DominantHand | null;
  /** @deprecated 절대 임계 대신 peak ratio 사용. 호환용 하한으로만 씀 */
  finishVelocityThreshold?: number;
  finishVelocityPeakRatio?: number;
  finishStableFrameCount?: number;
}

export interface SegmentSwingPhasesResult {
  phases: PhaseMarker[];
  /** 탐지에 사용한 트레일 손목 인덱스 */
  trailWristIndex: number;
  /** 실패/폴백 사유 (성공 시 null) */
  warning: string | null;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function nearestFrameIndex(
  frames: readonly LandmarkFrame[],
  timestampMs: number,
): number {
  if (frames.length === 0) {
    return 0;
  }
  let best = 0;
  let bestDist = Math.abs(frames[0].timestampMs - timestampMs);
  for (let i = 1; i < frames.length; i += 1) {
    const dist = Math.abs(frames[i].timestampMs - timestampMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function wristPoint(
  frame: LandmarkFrame,
  wristIndex: number,
): { x: number; y: number } | null {
  const point = frame.landmarks[wristIndex];
  if (!point) {
    return null;
  }
  return { x: point.x, y: point.y };
}

type WristSample = { x: number; y: number } | null;

function smoothedWristSamples(
  frames: readonly LandmarkFrame[],
  wristIndex: number,
): WristSample[] {
  return frames.map((_frame, index) => {
    let x = 0;
    let y = 0;
    let count = 0;
    const start = Math.max(0, index - WRIST_SMOOTHING_RADIUS_FRAMES);
    const end = Math.min(
      frames.length - 1,
      index + WRIST_SMOOTHING_RADIUS_FRAMES,
    );
    for (let i = start; i <= end; i += 1) {
      const point = wristPoint(frames[i], wristIndex);
      if (!point) {
        continue;
      }
      x += point.x;
      y += point.y;
      count += 1;
    }
    return count > 0 ? { x: x / count, y: y / count } : null;
  });
}

/**
 * 15fps 한 프레임 이동량으로 환산한 속도.
 * 같은 동작이 10/12/15fps 중 어느 설정으로 분석돼도 임계값 의미를 유지한다.
 */
function normalizedIntervalVelocity(
  frames: readonly LandmarkFrame[],
  samples: readonly WristSample[],
  nextIndex: number,
): number {
  if (nextIndex <= 0 || nextIndex >= frames.length) {
    return 0;
  }
  const a = samples[nextIndex - 1];
  const b = samples[nextIndex];
  const dtMs =
    frames[nextIndex].timestampMs - frames[nextIndex - 1].timestampMs;
  if (!a || !b || !Number.isFinite(dtMs) || dtMs <= 0) {
    return 0;
  }
  return Math.hypot(b.x - a.x, b.y - a.y) *
    (VELOCITY_REFERENCE_INTERVAL_MS / dtMs);
}

function marker(
  phase: SwingPhase,
  frames: readonly LandmarkFrame[],
  frameIndex: number,
  source: PhaseMarker['source'],
): PhaseMarker {
  const index = clampIndex(frameIndex, frames.length);
  return {
    phase,
    timestampMs: frames[index]?.timestampMs ?? 0,
    frameIndex: index,
    source,
  };
}

function interpolatedMarker(
  phase: SwingPhase,
  frames: readonly LandmarkFrame[],
  timestampMs: number,
): PhaseMarker {
  return timestampedMarker(phase, frames, timestampMs, 'interpolated');
}

function timestampedMarker(
  phase: SwingPhase,
  frames: readonly LandmarkFrame[],
  timestampMs: number,
  source: PhaseMarker['source'],
): PhaseMarker {
  const frameIndex = nearestFrameIndex(frames, timestampMs);
  return {
    phase,
    timestampMs,
    frameIndex,
    source,
  };
}

/**
 * LandmarkFrame[] → GolfDB 8단계 PhaseMarker[].
 * address/top/impact/finish = detected, 나머지 4개 = interpolated.
 */
export function segmentSwingPhases(
  frames: readonly LandmarkFrame[],
  options: SegmentSwingPhasesOptions = {},
): SegmentSwingPhasesResult {
  const trailWristIndex =
    options.trailWristIndex ??
    trailWristIndexForDominantHand(options.dominantHand);
  const finishVelocityFloor =
    options.finishVelocityThreshold ?? FINISH_VELOCITY_FLOOR;
  const finishVelocityPeakRatio =
    options.finishVelocityPeakRatio ?? FINISH_VELOCITY_PEAK_RATIO;
  const finishStableFrameCount =
    options.finishStableFrameCount ?? FINISH_STABLE_FRAME_COUNT;
  const wristSamples = smoothedWristSamples(frames, trailWristIndex);

  if (frames.length === 0) {
    return {
      phases: [],
      trailWristIndex,
      warning: 'empty frames',
    };
  }

  // 1) address = t=0
  const addressIndex = 0;

  // 2) impact 후보 = 아래로 이동하는 손목의 최대 속도.
  // 백스윙(위쪽 이동)과 피니시(다시 머리 쪽으로 이동)를 먼저 제외해야
  // 영상 전체 최고점인 피니시를 top으로 오인하지 않는다.
  let impactIndex = Math.min(frames.length - 1, addressIndex + 1);
  let maxVelocity = -1;
  let foundDownwardImpact = false;
  const impactCandidateStart = Math.min(
    frames.length - 1,
    addressIndex + TOP_SEARCH_MIN_OFFSET_FRAMES + IMPACT_SEARCH_MIN_OFFSET_FRAMES,
  );
  for (let i = Math.max(1, impactCandidateStart); i < frames.length; i += 1) {
    const previous = wristSamples[i - 1];
    const current = wristSamples[i];
    if (!previous || !current || current.y <= previous.y) {
      continue;
    }
    const velocity = normalizedIntervalVelocity(frames, wristSamples, i);
    if (velocity > maxVelocity) {
      maxVelocity = velocity;
      impactIndex = i;
      foundDownwardImpact = true;
    }
  }

  // 아래 방향 표본이 없을 때만 전체 2D 속도 피크로 폴백한다.
  if (!foundDownwardImpact) {
    for (let i = Math.max(1, impactCandidateStart); i < frames.length; i += 1) {
      const velocity = normalizedIntervalVelocity(frames, wristSamples, i);
      if (velocity > maxVelocity) {
        maxVelocity = velocity;
        impactIndex = i;
      }
    }
  }

  // 3) top = impact 이전 손목 y 최솟값 (화면 위쪽이 작은 y)
  let topIndex = addressIndex;
  let minY = Number.POSITIVE_INFINITY;
  const topSearchStart = Math.min(
    frames.length - 1,
    addressIndex + TOP_SEARCH_MIN_OFFSET_FRAMES,
  );
  const topSearchEnd = Math.max(topSearchStart, impactIndex - 1);
  for (let i = topSearchStart; i <= topSearchEnd; i += 1) {
    const point = wristSamples[i];
    if (!point) {
      continue;
    }
    if (point.y < minY) {
      minY = point.y;
      topIndex = i;
    }
  }
  if (!Number.isFinite(minY)) {
    topIndex = Math.min(
      Math.max(topSearchStart, Math.floor(frames.length * 0.35)),
      topSearchEnd,
    );
  }

  // 4) impact = top 이후 아래 방향 손목 속도 최댓값.
  // 앞 단계 후보가 너무 이른 노이즈였을 수 있으므로 top 기준으로 한 번 더 제한한다.
  const impactSearchStart = Math.min(
    frames.length - 1,
    topIndex + IMPACT_SEARCH_MIN_OFFSET_FRAMES,
  );
  let refinedImpactIndex = impactIndex;
  let refinedMaxVelocity = -1;
  for (let i = Math.max(1, impactSearchStart); i < frames.length; i += 1) {
    const previous = wristSamples[i - 1];
    const current = wristSamples[i];
    if (!previous || !current || current.y <= previous.y) {
      continue;
    }
    const velocity = normalizedIntervalVelocity(frames, wristSamples, i);
    if (velocity > refinedMaxVelocity) {
      refinedMaxVelocity = velocity;
      refinedImpactIndex = i;
    }
  }
  if (refinedMaxVelocity >= 0) {
    impactIndex = refinedImpactIndex;
    maxVelocity = refinedMaxVelocity;
  } else if (maxVelocity < 0) {
    impactIndex = Math.min(
      frames.length - 1,
      Math.max(topIndex + 1, Math.floor(frames.length * 0.55)),
    );
    maxVelocity = 0;
  }

  // 5) finish = impact 이후 속도가 (피크 대비 상대 임계) 이하로 N프레임 유지
  const finishVelocityThreshold = Math.max(
    finishVelocityFloor,
    maxVelocity * finishVelocityPeakRatio,
  );
  let finishIndex = frames.length - 1;
  let stableCount = 0;
  let foundFinish: 'threshold' | 'soft' | null = null;
  for (let i = Math.max(1, impactIndex + 1); i < frames.length; i += 1) {
    const velocity = normalizedIntervalVelocity(frames, wristSamples, i);
    if (velocity <= finishVelocityThreshold) {
      stableCount += 1;
      if (stableCount >= finishStableFrameCount) {
        // 정지 확인이 끝난 프레임이 아니라 정지가 시작된 프레임을 피니시로 표시한다.
        // 10~15fps에서 기존 방식은 항상 200~300ms 늦었다.
        finishIndex = i - stableCount + 1;
        foundFinish = 'threshold';
        break;
      }
    } else {
      stableCount = 0;
    }
  }

  // soft: 임계에 못 미치면 impact 이후 후반부에서 가장 조용한 지점
  if (!foundFinish && frames.length > impactIndex + 3) {
    const searchStart = Math.min(
      frames.length - 1,
      impactIndex +
        Math.max(
          2,
          Math.floor(
            (frames.length - 1 - impactIndex) * FINISH_SOFT_SEARCH_START_RATIO,
          ),
        ),
    );
    let quietestIndex = frames.length - 1;
    let quietestScore = Number.POSITIVE_INFINITY;
    for (let i = searchStart; i < frames.length; i += 1) {
      const windowStart = Math.max(1, i - finishStableFrameCount + 1);
      let sum = 0;
      let count = 0;
      for (let j = windowStart; j <= i; j += 1) {
        sum += normalizedIntervalVelocity(frames, wristSamples, j);
        count += 1;
      }
      const avg = count > 0 ? sum / count : Number.POSITIVE_INFINITY;
      if (avg < quietestScore) {
        quietestScore = avg;
        quietestIndex = i;
      }
    }
    finishIndex = quietestIndex;
    foundFinish = 'soft';
  }

  if (!foundFinish) {
    finishIndex = frames.length - 1;
  }

  // 순서 보정: address ≤ top ≤ impact ≤ finish
  topIndex = Math.max(topIndex, addressIndex);
  impactIndex = Math.max(
    impactIndex,
    Math.min(frames.length - 1, topIndex + 1),
  );
  finishIndex = Math.max(finishIndex, impactIndex);

  const tAddress = frames[addressIndex].timestampMs;
  const tTop = frames[topIndex].timestampMs;
  // interval(i-1 → i)의 속도를 i 시각에 귀속하면 반 프레임 늦다.
  const rawImpactTime =
    impactIndex > 0
      ? (frames[impactIndex - 1].timestampMs +
          frames[impactIndex].timestampMs) /
        2
      : frames[impactIndex].timestampMs;
  const tImpact = Math.max(tTop, rawImpactTime);
  const tFinish = frames[finishIndex].timestampMs;

  // 보간 4개
  const tToeUp = (tAddress + tTop) / 2;
  const tMidBackswing = (tToeUp + tTop) / 2;
  const tMidDownswing = (tTop + tImpact) / 2;
  const tMidFollow = (tImpact + tFinish) / 2;

  const phases: PhaseMarker[] = [
    marker('address', frames, addressIndex, 'detected'),
    interpolatedMarker('toe_up', frames, tToeUp),
    interpolatedMarker('mid_backswing', frames, tMidBackswing),
    marker('top', frames, topIndex, 'detected'),
    interpolatedMarker('mid_downswing', frames, tMidDownswing),
    timestampedMarker('impact', frames, tImpact, 'detected'),
    interpolatedMarker('mid_follow_through', frames, tMidFollow),
    marker('finish', frames, finishIndex, 'detected'),
  ];

  let warning: string | null = null;
  if (frames.length < 15) {
    warning = 'short sequence — phase estimates may be unreliable';
  } else if (!foundFinish) {
    warning = 'finish fallback to last frame (velocity never settled)';
  }

  return { phases, trailWristIndex, warning };
}
