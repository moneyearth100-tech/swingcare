/**
 * 게이트 2 — 녹화 중 어드레스 안정 감지 (순수 상태머신).
 * 안정 ~1.7초 연속 + 녹화 시작 후 최소 대기(~2초).
 * 이미 테이크어웨이(고속)가 지나갔으면 발화하지 않음.
 *
 * 실시간 MediaPipe 손목 좌표는 오프라인 trim 대비 노이즈가 커서
 * trimSwingWindow 의 ADDRESS_STABLE_VELOCITY / TAKEAWAY_VELOCITY 를
 * 그대로 쓰면 안정 구간이 거의 안 잡히거나 지터로 skip 될 수 있음.
 *
 * 포즈가 보이기만 해도 발화하는 fallback 은 두지 않음 —
 * 가짜 조기 음성보다 미발화가 낫다.
 */

import type { PoseLandmarks } from './landmarkTypes';
import { LANDMARK_INDEX } from './landmarkTypes';
import {
  PERSON_PRESENT_CORE_VISIBILITY,
  averageCoreVisibility,
} from './posePresence';
import { trailWristIndexForDominantHand } from './scoring/movementMetrics';
import type { DominantHand } from './scoring/movementMetrics';
import { VELOCITY_REFERENCE_INTERVAL_MS } from './phaseSegmentation';

/** 어드레스 안정으로 인정할 연속 시간 (게이트 2: ~1.7초) */
export const ADDRESS_READY_STABLE_MS = 1700;

/** 녹화 시작 후 포즈 안정화 루틴 시작까지 최소 대기 (버튼 누름→어드레스 잡는 시간) */
export const ADDRESS_READY_MIN_WAIT_MS = 2000;

/**
 * 라이브 어드레스 안정 속도 상한 (15fps 환산, EMA 적용 후).
 * trim 의 0.018 / 이전 0.035 보다 느슨 —
 * iPhone MediaPipe 손목 지터(±0.01 근처)가 매 프레임 리셋하지 않게.
 * 고의 흔들림(±0.02 → vel≈0.08)은 여전히 안정으로 안 잡힘.
 */
export const ADDRESS_READY_STABLE_VELOCITY = 0.045;

/**
 * 테이크어웨이로 보고 발화를 건너뛸 속도.
 * trim 의 0.045 보다 높게 — 지터/미세 흔들림으로 skip 되지 않게.
 * 연속 2프레임 이상일 때만 skip (단일 스파이크 오탐 방지).
 */
export const ADDRESS_READY_TAKEAWAY_VELOCITY = 0.12;

/** 라이브 속도 EMA — 프레임 스파이크가 안정 타이머를 끊지 않게 */
const VELOCITY_EMA_ALPHA = 0.35;

/** 테이크어웨이 확정에 필요한 연속 고속 프레임 수 */
const TAKEAWAY_STREAK_FRAMES = 2;

export type AddressReadyPhase =
  | 'idle'
  | 'waiting'
  | 'stabilizing'
  | 'ready'
  | 'skipped_swing_started';

export type AddressReadyPushResult = 'fire' | null;

/** fire 는 실제 안정 홀드만 허용 */
export type AddressReadyFireReason = 'stable_hold';

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

function hipMid(landmarks: PoseLandmarks): Point2 | null {
  const lh = landmarks[LANDMARK_INDEX.left_hip];
  const rh = landmarks[LANDMARK_INDEX.right_hip];
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

export interface AddressReadyDetectorOptions {
  dominantHand?: DominantHand | null;
  stableMs?: number;
  minWaitMs?: number;
  stableVelocity?: number;
  takeawayVelocity?: number;
}

export interface AddressReadyDetector {
  reset: () => void;
  getPhase: () => AddressReadyPhase;
  getLastFireReason: () => AddressReadyFireReason | null;
  /**
   * 디버그 스냅샷 — 스로틀 로그용.
   */
  getDebugSnapshot: () => {
    phase: AddressReadyPhase;
    timestampMs: number;
    wristVel: number;
    hipVel: number;
    visible: boolean;
    coreVis: number;
    stableMsHeld: number;
    fired: boolean;
    swingStarted: boolean;
  };
  /**
   * 녹화 중 프레임 유입.
   * @returns 'fire' — 이번 호출에서 최초로 준비 완료 (음성 1회 트리거)
   */
  push: (
    landmarks: PoseLandmarks,
    timestampMs: number,
  ) => AddressReadyPushResult;
}

export function createAddressReadyDetector(
  options: AddressReadyDetectorOptions = {},
): AddressReadyDetector {
  const stableMs = options.stableMs ?? ADDRESS_READY_STABLE_MS;
  const minWaitMs = options.minWaitMs ?? ADDRESS_READY_MIN_WAIT_MS;
  const stableVelocity =
    options.stableVelocity ?? ADDRESS_READY_STABLE_VELOCITY;
  const takeawayVelocity =
    options.takeawayVelocity ?? ADDRESS_READY_TAKEAWAY_VELOCITY;
  const trailWristIndex = trailWristIndexForDominantHand(
    options.dominantHand ?? null,
  );

  let phase: AddressReadyPhase = 'idle';
  let stableSinceMs: number | null = null;
  let fired = false;
  let fireReason: AddressReadyFireReason | null = null;
  let swingStarted = false;
  let prevTs: number | null = null;
  let prevWrist: Point2 | null = null;
  let prevHip: Point2 | null = null;
  let lastWristVel = 0;
  let lastHipVel = 0;
  let wristVelEma = 0;
  let hipVelEma = 0;
  let takeawayStreak = 0;
  let lastCoreVis = 0;
  let lastVisible = false;
  let lastTimestampMs = 0;
  let debugLogAtMs = -Infinity;

  const reset = () => {
    phase = 'idle';
    stableSinceMs = null;
    fired = false;
    fireReason = null;
    swingStarted = false;
    prevTs = null;
    prevWrist = null;
    prevHip = null;
    lastWristVel = 0;
    lastHipVel = 0;
    wristVelEma = 0;
    hipVelEma = 0;
    takeawayStreak = 0;
    lastCoreVis = 0;
    lastVisible = false;
    lastTimestampMs = 0;
    debugLogAtMs = -Infinity;
  };

  const markFire = (timestampMs: number) => {
    fired = true;
    fireReason = 'stable_hold';
    phase = 'ready';
    console.log('[addressReadyCue] fire', {
      reason: 'stable_hold',
      timestampMs,
      heldMs:
        stableSinceMs != null ? timestampMs - stableSinceMs : null,
      trailWristIndex,
      wristVel: Number(lastWristVel.toFixed(3)),
      hipVel: Number(lastHipVel.toFixed(3)),
    });
    return 'fire' as const;
  };

  const push = (
    landmarks: PoseLandmarks,
    timestampMs: number,
  ): AddressReadyPushResult => {
    lastTimestampMs = timestampMs;
    if (fired) {
      phase = 'ready';
      return null;
    }
    if (swingStarted) {
      phase = 'skipped_swing_started';
      return null;
    }

    if (timestampMs < minWaitMs) {
      phase = 'waiting';
      prevTs = timestampMs;
      prevWrist = wristPoint(landmarks, trailWristIndex);
      prevHip = hipMid(landmarks);
      return null;
    }

    const dtMs = prevTs != null ? timestampMs - prevTs : 0;
    const wrist = wristPoint(landmarks, trailWristIndex);
    const hip = hipMid(landmarks);
    const wristVel = velocity(prevWrist, wrist, dtMs);
    const hipVel = velocity(prevHip, hip, dtMs);
    prevTs = timestampMs;
    prevWrist = wrist ?? prevWrist;
    prevHip = hip ?? prevHip;
    lastWristVel = wristVel;
    lastHipVel = hipVel;

    // EMA — 단일 프레임 지터가 안정 홀드를 끊지 않게
    if (dtMs > 0) {
      wristVelEma =
        VELOCITY_EMA_ALPHA * wristVel + (1 - VELOCITY_EMA_ALPHA) * wristVelEma;
      hipVelEma =
        VELOCITY_EMA_ALPHA * hipVel + (1 - VELOCITY_EMA_ALPHA) * hipVelEma;
    }

    // 이미 스윙(테이크어웨이)이 시작됐으면 발화 안 함 — 연속 프레임 확인
    if (wristVel >= takeawayVelocity) {
      takeawayStreak += 1;
    } else {
      takeawayStreak = 0;
    }
    if (takeawayStreak >= TAKEAWAY_STREAK_FRAMES) {
      swingStarted = true;
      stableSinceMs = null;
      phase = 'skipped_swing_started';
      console.log('[addressReadyCue] skip — swing motion already started', {
        timestampMs,
        wristVel: Number(wristVel.toFixed(3)),
        wristVelEma: Number(wristVelEma.toFixed(3)),
        takeawayVelocity,
        takeawayStreak,
      });
      return null;
    }

    const coreVis = averageCoreVisibility(landmarks);
    const visible = coreVis >= PERSON_PRESENT_CORE_VISIBILITY;
    lastCoreVis = coreVis;
    lastVisible = visible;

    const stable =
      visible &&
      wristVelEma <= stableVelocity &&
      hipVelEma <= stableVelocity;

    if (timestampMs - debugLogAtMs >= 1000) {
      debugLogAtMs = timestampMs;
      console.log('[addressReadyCue] detector tick', {
        phase,
        timestampMs,
        visible,
        coreVis: Number(coreVis.toFixed(2)),
        wristVel: Number(wristVel.toFixed(3)),
        hipVel: Number(hipVel.toFixed(3)),
        wristVelEma: Number(wristVelEma.toFixed(3)),
        hipVelEma: Number(hipVelEma.toFixed(3)),
        stableVelocity,
        stableMsHeld:
          stableSinceMs != null ? Math.round(timestampMs - stableSinceMs) : 0,
        whyNotFire: fired
          ? 'already_fired'
          : swingStarted
            ? 'swing_started'
            : !visible
              ? 'pose_not_visible'
              : wristVelEma > stableVelocity || hipVelEma > stableVelocity
                ? 'velocity_high'
                : stableSinceMs == null
                  ? 'stable_timer_not_started'
                  : timestampMs - stableSinceMs < stableMs
                    ? 'stable_hold_short'
                    : 'ready_to_fire',
      });
    }

    if (!stable) {
      stableSinceMs = null;
      phase = 'waiting';
      return null;
    }

    if (stableSinceMs == null) {
      stableSinceMs = timestampMs;
      phase = 'stabilizing';
      return null;
    }

    const held = timestampMs - stableSinceMs;
    if (held < stableMs) {
      phase = 'stabilizing';
      return null;
    }

    return markFire(timestampMs);
  };

  return {
    reset,
    getPhase: () => phase,
    getLastFireReason: () => fireReason,
    getDebugSnapshot: () => ({
      phase,
      timestampMs: lastTimestampMs,
      wristVel: lastWristVel,
      hipVel: lastHipVel,
      visible: lastVisible,
      coreVis: lastCoreVis,
      stableMsHeld:
        stableSinceMs != null && lastTimestampMs >= stableSinceMs
          ? lastTimestampMs - stableSinceMs
          : 0,
      fired,
      swingStarted,
    }),
    push,
  };
}

export const ADDRESS_READY_SPEECH_TEXT = '준비됐습니다. 스윙하세요';
