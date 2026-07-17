/**
 * 게이트 3 — 라이브 녹화 중 피니시 감지 (순수 상태머신).
 * 어드레스 대기 중에는 finish로 멈추지 않음.
 * 테이크어웨이/스윙 시작 후에만 finish를 보고, 훅이 pad 후 stopRecording.
 *
 * trimSwingWindow / phaseSegmentation 임계값은 건드리지 않음.
 * 라이브 MediaPipe 지터용 상수만 여기서 둔다.
 */

import type { PoseLandmarks } from './landmarkTypes';
import {
  PERSON_PRESENT_CORE_VISIBILITY,
  averageCoreVisibility,
} from './posePresence';
import { trailWristIndexForDominantHand } from './scoring/movementMetrics';
import type { DominantHand } from './scoring/movementMetrics';
import {
  FINISH_STABLE_FRAME_COUNT,
  FINISH_VELOCITY_FLOOR,
  FINISH_VELOCITY_PEAK_RATIO,
  VELOCITY_REFERENCE_INTERVAL_MS,
} from './phaseSegmentation';

/**
 * 피니시 확정 후 녹화 종료까지 여유 (게이트 3: 0.5–1s).
 * trim 의 FINISH_PAD_MS(220) 와 별개 — 라이브 자동정지 전용.
 */
export const FINISH_AUTO_STOP_PAD_MS = 750;

/** 피니시 미감지 시 강제 정지 (무한 녹화 방지) */
export const RECORD_TIMEOUT_MS = 15_000;

/**
 * 테이크어웨이(스윙 시작) — Gate 2 ADDRESS_READY_TAKEAWAY_VELOCITY 와 맞춤.
 * trim TAKEAWAY(0.045)보다 높아 지터 오탐을 줄임.
 */
export const FINISH_AUTO_TAKEAWAY_VELOCITY = 0.12;

/** 테이크어웨이 연속 프레임 */
const TAKEAWAY_STREAK_FRAMES = 2;

/** impact 피크로 인정할 최소 손목 속도 (지터 아래면 스윙으로 안 봄) */
export const FINISH_AUTO_MIN_PEAK_VELOCITY = 0.14;

/** 스윙 시작 후 finish 판정까지 최소 경과 */
export const FINISH_AUTO_MIN_SWING_MS = 450;

/** 라이브 속도 EMA — 단일 스파이크가 finish 안정 카운트를 리셋하지 않게 */
const VELOCITY_EMA_ALPHA = 0.4;

export type FinishAutoStopPhase =
  | 'idle'
  | 'waiting'
  | 'watching'
  | 'swing'
  | 'finish';

export type FinishAutoStopPushResult = 'swing' | 'finish' | null;

type Point2 = { x: number; y: number };

function wristPoint(
  landmarks: PoseLandmarks,
  wristIndex: number,
): Point2 | null {
  const point = landmarks[wristIndex];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  return { x: point.x, y: point.y };
}

function velocity(
  prev: Point2 | null,
  next: Point2 | null,
  dtMs: number,
): number {
  if (!prev || !next || !Number.isFinite(dtMs) || dtMs <= 0) {
    return 0;
  }
  return (
    Math.hypot(next.x - prev.x, next.y - prev.y) *
    (VELOCITY_REFERENCE_INTERVAL_MS / dtMs)
  );
}

export interface FinishAutoStopDetectorOptions {
  dominantHand?: DominantHand | null;
  takeawayVelocity?: number;
  minPeakVelocity?: number;
  minSwingMs?: number;
  finishVelocityFloor?: number;
  finishVelocityPeakRatio?: number;
  finishStableFrameCount?: number;
}

export interface FinishAutoStopDetector {
  /** 녹화 시작 — waiting (어드레스 대기, finish 미활성) */
  arm: () => void;
  reset: () => void;
  /** Gate 2 ready / skipped — finish watch arm (어드레스 대기 해제) */
  notifyAddressReadyOrSwing: (reason: string) => void;
  getPhase: () => FinishAutoStopPhase;
  getDebugSnapshot: () => {
    phase: FinishAutoStopPhase;
    timestampMs: number;
    wristVel: number;
    wristVelEma: number;
    maxVelocity: number;
    impactSeen: boolean;
    stableCount: number;
    swingSinceMs: number | null;
  };
  push: (
    landmarks: PoseLandmarks,
    timestampMs: number,
  ) => FinishAutoStopPushResult;
}

export function createFinishAutoStopDetector(
  options: FinishAutoStopDetectorOptions = {},
): FinishAutoStopDetector {
  const takeawayVelocity =
    options.takeawayVelocity ?? FINISH_AUTO_TAKEAWAY_VELOCITY;
  const minPeakVelocity =
    options.minPeakVelocity ?? FINISH_AUTO_MIN_PEAK_VELOCITY;
  const minSwingMs = options.minSwingMs ?? FINISH_AUTO_MIN_SWING_MS;
  const finishVelocityFloor =
    options.finishVelocityFloor ?? FINISH_VELOCITY_FLOOR;
  const finishVelocityPeakRatio =
    options.finishVelocityPeakRatio ?? FINISH_VELOCITY_PEAK_RATIO;
  const finishStableFrameCount =
    options.finishStableFrameCount ?? FINISH_STABLE_FRAME_COUNT;
  const trailWristIndex = trailWristIndexForDominantHand(
    options.dominantHand ?? null,
  );

  let phase: FinishAutoStopPhase = 'idle';
  let prevTs: number | null = null;
  let prevWrist: Point2 | null = null;
  let lastWristVel = 0;
  let wristVelEma = 0;
  let takeawayStreak = 0;
  let swingSinceMs: number | null = null;
  let maxVelocity = 0;
  let impactSeen = false;
  let stableCount = 0;
  let finishEmitted = false;
  let swingEmitted = false;
  let lastTimestampMs = 0;
  let debugLogAtMs = -Infinity;

  const clearMotionState = () => {
    prevTs = null;
    prevWrist = null;
    lastWristVel = 0;
    wristVelEma = 0;
    takeawayStreak = 0;
    swingSinceMs = null;
    maxVelocity = 0;
    impactSeen = false;
    stableCount = 0;
    finishEmitted = false;
    swingEmitted = false;
    lastTimestampMs = 0;
    debugLogAtMs = -Infinity;
  };

  const reset = () => {
    phase = 'idle';
    clearMotionState();
  };

  const arm = () => {
    clearMotionState();
    phase = 'waiting';
    console.log('[finishAutoStop] armed', {
      trailWristIndex,
      takeawayVelocity,
      minPeakVelocity,
      minSwingMs,
      padNote: 'pad/timeout owned by hook',
    });
  };

  const notifyAddressReadyOrSwing = (reason: string) => {
    if (phase === 'idle' || phase === 'finish' || phase === 'swing') {
      return;
    }
    if (phase !== 'waiting' && phase !== 'watching') {
      return;
    }

    // Gate 2 가 이미 테이크어웨이로 skip 했으면 바로 swing —
    // 이후 프레임만으로는 takeaway streak 를 다시 못 볼 수 있음.
    if (
      reason === 'skipped_swing_started' ||
      reason.includes('skipped_swing')
    ) {
      phase = 'swing';
      if (swingSinceMs == null) {
        swingSinceMs = lastTimestampMs;
      }
      if (!swingEmitted) {
        swingEmitted = true;
        console.log('[finishAutoStop] swing detected', {
          via: 'gate2_skip',
          reason,
          timestampMs: lastTimestampMs,
        });
      }
      return;
    }

    if (phase === 'waiting') {
      phase = 'watching';
      console.log('[finishAutoStop] armed for finish watch', {
        reason,
        timestampMs: lastTimestampMs,
      });
    }
  };

  const markSwing = (timestampMs: number): FinishAutoStopPushResult => {
    if (phase === 'swing' || phase === 'finish') {
      return null;
    }
    phase = 'swing';
    swingSinceMs = timestampMs;
    maxVelocity = Math.max(maxVelocity, lastWristVel, wristVelEma);
    if (!swingEmitted) {
      swingEmitted = true;
      console.log('[finishAutoStop] swing detected', {
        timestampMs,
        wristVel: Number(lastWristVel.toFixed(3)),
        wristVelEma: Number(wristVelEma.toFixed(3)),
        takeawayVelocity,
      });
      return 'swing';
    }
    return null;
  };

  const markFinish = (timestampMs: number): FinishAutoStopPushResult => {
    if (finishEmitted) {
      return null;
    }
    finishEmitted = true;
    phase = 'finish';
    const threshold = Math.max(
      finishVelocityFloor,
      maxVelocity * finishVelocityPeakRatio,
    );
    console.log('[finishAutoStop] finish detected', {
      timestampMs,
      maxVelocity: Number(maxVelocity.toFixed(3)),
      threshold: Number(threshold.toFixed(3)),
      wristVelEma: Number(wristVelEma.toFixed(3)),
      swingMs:
        swingSinceMs != null ? Math.round(timestampMs - swingSinceMs) : null,
    });
    return 'finish';
  };

  const push = (
    landmarks: PoseLandmarks,
    timestampMs: number,
  ): FinishAutoStopPushResult => {
    lastTimestampMs = timestampMs;

    if (phase === 'idle' || phase === 'finish') {
      return null;
    }

    const dtMs = prevTs != null ? timestampMs - prevTs : 0;
    const wrist = wristPoint(landmarks, trailWristIndex);
    const priorWrist = prevWrist;
    const wristVel = velocity(prevWrist, wrist, dtMs);
    prevTs = timestampMs;
    prevWrist = wrist ?? prevWrist;
    lastWristVel = wristVel;

    if (dtMs > 0) {
      wristVelEma =
        VELOCITY_EMA_ALPHA * wristVel + (1 - VELOCITY_EMA_ALPHA) * wristVelEma;
    }

    const coreVis = averageCoreVisibility(landmarks);
    const visible = coreVis >= PERSON_PRESENT_CORE_VISIBILITY;

    if (timestampMs - debugLogAtMs >= 2000) {
      debugLogAtMs = timestampMs;
      console.log('[finishAutoStop] detector tick', {
        phase,
        timestampMs,
        visible,
        wristVel: Number(wristVel.toFixed(3)),
        wristVelEma: Number(wristVelEma.toFixed(3)),
        maxVelocity: Number(maxVelocity.toFixed(3)),
        impactSeen,
        stableCount,
      });
    }

    // 어드레스 대기 중에도 강한 테이크어웨이는 스윙으로 승격 (Gate 2 skip 경로와 동일)
    if (phase === 'waiting' || phase === 'watching') {
      if (visible && wristVel >= takeawayVelocity) {
        takeawayStreak += 1;
      } else {
        takeawayStreak = 0;
      }
      if (takeawayStreak >= TAKEAWAY_STREAK_FRAMES) {
        return markSwing(timestampMs);
      }
      return null;
    }

    // phase === 'swing'
    if (!visible) {
      return null;
    }

    if (wristVel > maxVelocity) {
      maxVelocity = wristVel;
    }
    if (wristVelEma > maxVelocity) {
      maxVelocity = wristVelEma;
    }

    if (maxVelocity >= minPeakVelocity) {
      if (
        priorWrist != null &&
        wrist != null &&
        wrist.y > priorWrist.y &&
        wristVel >= minPeakVelocity * 0.85
      ) {
        impactSeen = true;
      } else if (maxVelocity >= minPeakVelocity) {
        impactSeen = true;
      }
    }

    const swingElapsed =
      swingSinceMs != null ? timestampMs - swingSinceMs : 0;
    if (!impactSeen || swingElapsed < minSwingMs) {
      stableCount = 0;
      return null;
    }

    const finishThreshold = Math.max(
      finishVelocityFloor,
      maxVelocity * finishVelocityPeakRatio,
    );

    if (wristVelEma <= finishThreshold) {
      stableCount += 1;
      if (stableCount >= finishStableFrameCount) {
        return markFinish(timestampMs);
      }
    } else {
      stableCount = 0;
    }

    return null;
  };

  return {
    arm,
    reset,
    notifyAddressReadyOrSwing,
    getPhase: () => phase,
    getDebugSnapshot: () => ({
      phase,
      timestampMs: lastTimestampMs,
      wristVel: lastWristVel,
      wristVelEma,
      maxVelocity,
      impactSeen,
      stableCount,
      swingSinceMs,
    }),
    push,
  };
}
