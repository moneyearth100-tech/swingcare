/**
 * 스윙 분석 윈도우 트리밍 — 어드레스(안정 자세)~피니시(+여유).
 * 게이트 1: 음성/자동종료 없음. 실패 시 원본 폴백.
 */

import type { LandmarkFrame } from './landmarkTypes';
import { LANDMARK_INDEX } from './landmarkTypes';
import {
  PERSON_PRESENT_CORE_VISIBILITY,
  averageCoreVisibility,
} from './posePresence';
import {
  DEFAULT_TRAIL_WRIST_INDEX,
  FINISH_SOFT_SEARCH_START_RATIO,
  FINISH_STABLE_FRAME_COUNT,
  FINISH_VELOCITY_FLOOR,
  FINISH_VELOCITY_PEAK_RATIO,
  IMPACT_SEARCH_MIN_OFFSET_FRAMES,
  TOP_SEARCH_MIN_OFFSET_FRAMES,
  VELOCITY_REFERENCE_INTERVAL_MS,
} from './phaseSegmentation';
import {
  trailWristIndexForDominantHand,
  type DominantHand,
} from './scoring/movementMetrics';

/** 어드레스로 인정할 최소 안정 지속 시간 */
export const ADDRESS_STABLE_MS = 500;

/**
 * 테이크어웨이 직전 안정 구간에서 분석 윈도우에 남길 어드레스 홀드.
 * 긴 대기(앞부분)는 자르고, 이 길이만큼만 address로 남긴다.
 */
export const ADDRESS_HOLD_MS = 450;

/**
 * 안정 판정 손목/엉덩이 속도 상한 (15fps 환산).
 * 라이브 MediaPipe 지터를 감안해 이전 0.018보다 완화 — Gate2와 맞추되
 * ADDRESS_READY(0.045)보다는 약간 타이트.
 */
export const ADDRESS_STABLE_VELOCITY = 0.032;

/** 테이크어웨이(움직임 시작)로 볼 속도 */
export const TAKEAWAY_VELOCITY = 0.055;

/** 피니시 이후 버퍼에 남길 여유 */
export const FINISH_PAD_MS = 220;

/** 트리밍 결과가 이보다 짧으면 폴백 */
export const MIN_TRIMMED_FRAMES = 12;

export interface TrimSwingWindowOptions {
  dominantHand?: DominantHand | null;
  trailWristIndex?: number;
  finishPadMs?: number;
  /**
   * Gate 2 「준비됐습니다」 발화 시점(원본 timestampMs).
   * 있으면 이 시각의 프레임을 윈도우 시작으로 쓴다 — 녹화 버튼~안내 구간을 자른다.
   */
  addressReadyMs?: number | null;
  /** console 로그 태그. 기본 '[trimSwingWindow]' */
  logTag?: string;
  /** false면 로그 생략 (테스트용) */
  log?: boolean;
}

export interface TrimSwingWindowResult {
  frames: LandmarkFrame[];
  /** 원본 기준 inclusive */
  startIndex: number;
  endIndex: number;
  beforeFrameCount: number;
  afterFrameCount: number;
  trimmedHeadMs: number;
  trimmedTailMs: number;
  /** 폴백이면 true — frames는 원본 */
  fallback: boolean;
  warning: string | null;
}

type Point2 = { x: number; y: number };

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

/** addressReadyMs 이상인 첫 프레임. 없으면 null */
function findFrameIndexAtOrAfterMs(
  frames: readonly LandmarkFrame[],
  ms: number | null | undefined,
): number | null {
  if (ms == null || !Number.isFinite(ms) || frames.length === 0) {
    return null;
  }
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].timestampMs >= ms) {
      return i;
    }
  }
  // 모든 프레임이 cue 이전이면 마지막 — finish와 겹치면 이후 검증에서 폴백
  return frames.length - 1;
}

function wristPoint(
  frame: LandmarkFrame,
  wristIndex: number,
): Point2 | null {
  const point = frame.landmarks[wristIndex];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  return { x: point.x, y: point.y };
}

function hipMid(frame: LandmarkFrame): Point2 | null {
  const lh = frame.landmarks[LANDMARK_INDEX.left_hip];
  const rh = frame.landmarks[LANDMARK_INDEX.right_hip];
  if (
    !lh ||
    !rh ||
    !Number.isFinite(lh.x) ||
    !Number.isFinite(lh.y) ||
    !Number.isFinite(rh.x) ||
    !Number.isFinite(rh.y)
  ) {
    return null;
  }
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
}

function intervalVelocity(
  frames: readonly LandmarkFrame[],
  a: Point2 | null,
  b: Point2 | null,
  nextIndex: number,
): number {
  if (nextIndex <= 0 || !a || !b) {
    return 0;
  }
  const dtMs =
    frames[nextIndex].timestampMs - frames[nextIndex - 1].timestampMs;
  if (!Number.isFinite(dtMs) || dtMs <= 0) {
    return 0;
  }
  return (
    Math.hypot(b.x - a.x, b.y - a.y) * (VELOCITY_REFERENCE_INTERVAL_MS / dtMs)
  );
}

function frameVelocities(
  frames: readonly LandmarkFrame[],
  trailWristIndex: number,
): { wrist: number[]; hip: number[] } {
  const wrist: number[] = new Array(frames.length).fill(0);
  const hip: number[] = new Array(frames.length).fill(0);
  let prevWrist: Point2 | null = wristPoint(frames[0], trailWristIndex);
  let prevHip: Point2 | null = hipMid(frames[0]);
  for (let i = 1; i < frames.length; i += 1) {
    const w = wristPoint(frames[i], trailWristIndex);
    const h = hipMid(frames[i]);
    wrist[i] = intervalVelocity(frames, prevWrist, w, i);
    hip[i] = intervalVelocity(frames, prevHip, h, i);
    prevWrist = w ?? prevWrist;
    prevHip = h ?? prevHip;
  }
  return { wrist, hip };
}

function isStableFrame(
  frame: LandmarkFrame,
  wristVel: number,
  hipVel: number,
): boolean {
  if (averageCoreVisibility(frame.landmarks) < PERSON_PRESENT_CORE_VISIBILITY) {
    return false;
  }
  return (
    wristVel <= ADDRESS_STABLE_VELOCITY && hipVel <= ADDRESS_STABLE_VELOCITY
  );
}

/**
 * 테이크어웨이 이전 마지막 안정 구간의 시작 인덱스.
 * 없으면 null → 호출측 폴백.
 */
export function findAddressStableIndex(
  frames: readonly LandmarkFrame[],
  trailWristIndex: number,
): number | null {
  if (frames.length < MIN_TRIMMED_FRAMES) {
    return null;
  }

  const { wrist, hip } = frameVelocities(frames, trailWristIndex);

  // 첫 지속 고속(테이크어웨이) — 그 앞에서 어드레스를 찾는다.
  let takeawayIndex = frames.length - 1;
  let burst = 0;
  for (let i = 1; i < frames.length; i += 1) {
    if (wrist[i] >= TAKEAWAY_VELOCITY) {
      burst += 1;
      if (burst >= 2) {
        takeawayIndex = i - burst + 1;
        break;
      }
    } else {
      burst = 0;
    }
  }

  const searchEnd = Math.max(1, takeawayIndex);
  let bestStart: number | null = null;
  let bestEnd: number | null = null; // inclusive
  let runStart = -1;

  const closeRun = (endExclusive: number) => {
    if (runStart < 0 || endExclusive <= runStart) {
      return;
    }
    const endInclusive = endExclusive - 1;
    const durationMs =
      frames[endInclusive].timestampMs - frames[runStart].timestampMs;
    if (durationMs < ADDRESS_STABLE_MS) {
      return;
    }
    // 테이크어웨이 직전 안정 구간을 선호 (더 늦은 끝)
    if (bestEnd == null || endInclusive >= bestEnd) {
      bestStart = runStart;
      bestEnd = endInclusive;
    }
  };

  for (let i = 0; i < searchEnd; i += 1) {
    const stable = isStableFrame(frames[i], wrist[i], hip[i]);
    if (stable) {
      if (runStart < 0) {
        runStart = i;
      }
    } else if (runStart >= 0) {
      closeRun(i);
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    closeRun(searchEnd);
  }

  if (bestStart == null || bestEnd == null) {
    return null;
  }

  // 긴 앞 대기는 버리고, 홀드 구간만 address로 남긴다.
  const holdOriginMs = frames[bestEnd].timestampMs - ADDRESS_HOLD_MS;
  let addressIndex = bestStart;
  for (let i = bestStart; i <= bestEnd; i += 1) {
    if (frames[i].timestampMs >= holdOriginMs) {
      addressIndex = i;
      break;
    }
  }
  return addressIndex;
}

/**
 * impact 이후 속도 안정(=피니시) 인덱스. phaseSegmentation과 동일 휴리스틱.
 */
export function findFinishIndex(
  frames: readonly LandmarkFrame[],
  trailWristIndex: number,
  addressIndex: number,
): number | null {
  if (frames.length < 3) {
    return null;
  }

  const samples = frames.map((f) => wristPoint(f, trailWristIndex));
  const velocityAt = (i: number) =>
    intervalVelocity(frames, samples[i - 1] ?? null, samples[i] ?? null, i);

  let impactIndex = Math.min(frames.length - 1, addressIndex + 1);
  let maxVelocity = -1;
  let foundDownward = false;
  const impactCandidateStart = Math.min(
    frames.length - 1,
    addressIndex + TOP_SEARCH_MIN_OFFSET_FRAMES + IMPACT_SEARCH_MIN_OFFSET_FRAMES,
  );

  for (let i = Math.max(1, impactCandidateStart); i < frames.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (!previous || !current || current.y <= previous.y) {
      continue;
    }
    const velocity = velocityAt(i);
    if (velocity > maxVelocity) {
      maxVelocity = velocity;
      impactIndex = i;
      foundDownward = true;
    }
  }
  if (!foundDownward) {
    for (let i = Math.max(1, impactCandidateStart); i < frames.length; i += 1) {
      const velocity = velocityAt(i);
      if (velocity > maxVelocity) {
        maxVelocity = velocity;
        impactIndex = i;
      }
    }
  }

  // top → impact 재제한
  let topIndex = addressIndex;
  let minY = Number.POSITIVE_INFINITY;
  const topSearchStart = Math.min(
    frames.length - 1,
    addressIndex + TOP_SEARCH_MIN_OFFSET_FRAMES,
  );
  const topSearchEnd = Math.max(topSearchStart, impactIndex - 1);
  for (let i = topSearchStart; i <= topSearchEnd; i += 1) {
    const point = samples[i];
    if (point && point.y < minY) {
      minY = point.y;
      topIndex = i;
    }
  }

  const impactSearchStart = Math.min(
    frames.length - 1,
    topIndex + IMPACT_SEARCH_MIN_OFFSET_FRAMES,
  );
  let refinedMax = -1;
  let refinedImpact = impactIndex;
  for (let i = Math.max(1, impactSearchStart); i < frames.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (!previous || !current || current.y <= previous.y) {
      continue;
    }
    const velocity = velocityAt(i);
    if (velocity > refinedMax) {
      refinedMax = velocity;
      refinedImpact = i;
    }
  }
  if (refinedMax >= 0) {
    impactIndex = refinedImpact;
    maxVelocity = refinedMax;
  }

  const finishVelocityThreshold = Math.max(
    FINISH_VELOCITY_FLOOR,
    Math.max(0, maxVelocity) * FINISH_VELOCITY_PEAK_RATIO,
  );

  let stableCount = 0;
  for (let i = Math.max(1, impactIndex + 1); i < frames.length; i += 1) {
    if (velocityAt(i) <= finishVelocityThreshold) {
      stableCount += 1;
      if (stableCount >= FINISH_STABLE_FRAME_COUNT) {
        return i - stableCount + 1;
      }
    } else {
      stableCount = 0;
    }
  }

  if (frames.length > impactIndex + 3) {
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
      const windowStart = Math.max(1, i - FINISH_STABLE_FRAME_COUNT + 1);
      let sum = 0;
      let count = 0;
      for (let j = windowStart; j <= i; j += 1) {
        sum += velocityAt(j);
        count += 1;
      }
      const avg = count > 0 ? sum / count : Number.POSITIVE_INFINITY;
      if (avg < quietestScore) {
        quietestScore = avg;
        quietestIndex = i;
      }
    }
    return quietestIndex;
  }

  return null;
}

function sliceFrames(
  frames: readonly LandmarkFrame[],
  startIndex: number,
  endIndex: number,
): LandmarkFrame[] {
  // 원본 timestampMs 유지 — 영상 currentTime과 1:1 동기화
  return frames.slice(startIndex, endIndex + 1).map((frame) => ({
    ...frame,
    landmarks: frame.landmarks,
  }));
}

function emptyFallback(
  frames: readonly LandmarkFrame[],
  warning: string,
): TrimSwingWindowResult {
  return {
    frames: [...frames],
    startIndex: 0,
    endIndex: Math.max(0, frames.length - 1),
    beforeFrameCount: frames.length,
    afterFrameCount: frames.length,
    trimmedHeadMs: 0,
    trimmedTailMs: 0,
    fallback: true,
    warning,
  };
}

/**
 * address~finish(+pad)로 자른다. 실패 시 원본 + warning.
 */
export function trimSwingWindow(
  frames: readonly LandmarkFrame[],
  options: TrimSwingWindowOptions = {},
): TrimSwingWindowResult {
  const logTag = options.logTag ?? '[trimSwingWindow]';
  const shouldLog = options.log !== false;
  const beforeFrameCount = frames.length;
  const trailWristIndex =
    options.trailWristIndex ??
    (options.dominantHand != null
      ? trailWristIndexForDominantHand(options.dominantHand)
      : DEFAULT_TRAIL_WRIST_INDEX);
  const finishPadMs = options.finishPadMs ?? FINISH_PAD_MS;

  let addressFromCue: number | null = null;
  let addressFromPose: number | null = null;

  const logResult = (result: TrimSwingWindowResult) => {
    if (!shouldLog) {
      return;
    }
    console.log(logTag, {
      beforeFrames: result.beforeFrameCount,
      afterFrames: result.afterFrameCount,
      trimmedHeadMs: result.trimmedHeadMs,
      trimmedTailMs: result.trimmedTailMs,
      startIndex: result.startIndex,
      endIndex: result.endIndex,
      fallback: result.fallback,
      warning: result.warning,
      trailWristIndex,
      addressReadyMs: options.addressReadyMs ?? null,
      addressSource:
        addressFromCue != null
          ? 'gate2_cue'
          : addressFromPose != null
            ? 'pose_stable'
            : 'none',
      // fallback=true 이면 녹화/정지 버튼 앞뒤가 안 잘림 (address·finish 미감지 등)
      hint: result.fallback
        ? 'trim skipped — check warning (address/finish). Full buffer kept.'
        : 'trim ok — head/tail idle removed',
    });
  };

  if (frames.length === 0) {
    const empty = emptyFallback(frames, 'empty frames');
    logResult(empty);
    return empty;
  }

  const totalStartMs = frames[0].timestampMs;
  const totalEndMs = frames[frames.length - 1].timestampMs;

  addressFromCue = findFrameIndexAtOrAfterMs(
    frames,
    options.addressReadyMs ?? null,
  );
  addressFromPose = findAddressStableIndex(frames, trailWristIndex);
  // Gate 2 안내 시점이 있으면 그걸 시작으로 — 재생이 「준비됐습니다」부터
  const addressIndex = addressFromCue ?? addressFromPose;
  if (addressIndex == null) {
    const fb = emptyFallback(
      frames,
      'address stable pose not found — using full buffer',
    );
    logResult(fb);
    return fb;
  }

  const finishIndex = findFinishIndex(frames, trailWristIndex, addressIndex);
  if (finishIndex == null || finishIndex <= addressIndex) {
    const fb = emptyFallback(
      frames,
      'finish not found after address — using full buffer',
    );
    logResult(fb);
    return fb;
  }

  const finishTime = frames[finishIndex].timestampMs;
  const endTargetMs = finishTime + finishPadMs;
  let endIndex = finishIndex;
  for (let i = finishIndex; i < frames.length; i += 1) {
    if (frames[i].timestampMs <= endTargetMs) {
      endIndex = i;
    } else {
      break;
    }
  }
  endIndex = clampIndex(endIndex, frames.length);

  if (endIndex - addressIndex + 1 < MIN_TRIMMED_FRAMES) {
    const fb = emptyFallback(
      frames,
      'trimmed window too short — using full buffer',
    );
    logResult(fb);
    return fb;
  }

  const trimmed = sliceFrames(frames, addressIndex, endIndex);
  const result: TrimSwingWindowResult = {
    frames: trimmed,
    startIndex: addressIndex,
    endIndex,
    beforeFrameCount,
    afterFrameCount: trimmed.length,
    trimmedHeadMs: Math.max(
      0,
      Math.round(frames[addressIndex].timestampMs - totalStartMs),
    ),
    trimmedTailMs: Math.max(
      0,
      Math.round(totalEndMs - frames[endIndex].timestampMs),
    ),
    fallback: false,
    warning: null,
  };
  logResult(result);
  return result;
}
