/**
 * 이동지표 + 손목 코킹 (load_score_v2 movement_metrics).
 *
 * - weightShift / headRise: 어드레스 어깨너비로 정규화한 이동량
 * - dominant_hand 있으면 체중이동 방향성(타겟 방향 여부)까지 판단
 * - 손목 코킹: top 프레임만, elbow→wrist vs wrist→index 3D 각 (양쪽 계산)
 *
 * 2장 가드레일: 수치·구간만 — "부족해요" 등 단정 문구는 UI에서 쓰지 않음.
 */

import type {
  LandmarkFrame,
  PhaseMarker,
  PoseLandmarks,
  SwingPhase,
} from '../landmarkTypes';
import { LANDMARK_INDEX } from '../landmarkTypes';

import {
  MOVEMENT_DELTA_MEDIUM,
  MOVEMENT_DELTA_SMALL,
} from './balanceScoreConstants';
import { angleDegAt3D, isUsable } from './jointAngles';

export type DominantHand = 'right' | 'left';

export interface MovementMetrics {
  /** |hip(impact).x − hip(top).x| / shoulderWidth(address) */
  weightShiftDelta: number | null;
  /**
   * (hip(impact).x − hip(top).x) / shoulderWidth — 부호 유지.
   * 정면 기준: + = 화면 오른쪽(골퍼 왼발 쪽).
   */
  weightShiftSigned: number | null;
  /**
   * dominant_hand 있을 때만: 타겟(리드) 방향으로 이동했는지.
   * 없으면 null (크기만 표시).
   */
  weightShiftTowardTarget: boolean | null;
  /** |nose(address).y − nose(impact).y| / shoulderWidth(address) */
  headRiseDelta: number | null;
  /** top 시점 3D 코킹(도). visibility 미달 시 null */
  leftWristCockingDeg: number | null;
  rightWristCockingDeg: number | null;
}

export interface MovementMetricsOptions {
  dominantHand?: DominantHand | null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function frameForPhase(
  frames: readonly LandmarkFrame[],
  phases: readonly PhaseMarker[],
  phase: SwingPhase,
): LandmarkFrame | null {
  const marker = phases.find((p) => p.phase === phase);
  if (!marker) {
    return null;
  }
  if (
    marker.frameIndex >= 0 &&
    marker.frameIndex < frames.length &&
    frames[marker.frameIndex]
  ) {
    return frames[marker.frameIndex];
  }
  // timestamp 폴백
  let best: LandmarkFrame | null = null;
  let bestDist = Infinity;
  for (const frame of frames) {
    const d = Math.abs(frame.timestampMs - marker.timestampMs);
    if (d < bestDist) {
      bestDist = d;
      best = frame;
    }
  }
  return best;
}

function hipMidX(landmarks: PoseLandmarks): number | null {
  const lh = landmarks[LANDMARK_INDEX.left_hip];
  const rh = landmarks[LANDMARK_INDEX.right_hip];
  if (!isUsable(lh) || !isUsable(rh)) {
    return null;
  }
  return (lh.x + rh.x) / 2;
}

function shoulderWidth(landmarks: PoseLandmarks): number | null {
  const ls = landmarks[LANDMARK_INDEX.left_shoulder];
  const rs = landmarks[LANDMARK_INDEX.right_shoulder];
  if (!isUsable(ls) || !isUsable(rs)) {
    return null;
  }
  const w = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  return w > 1e-6 ? w : null;
}

function noseY(landmarks: PoseLandmarks): number | null {
  const nose = landmarks[LANDMARK_INDEX.nose];
  if (!isUsable(nose)) {
    return null;
  }
  return nose.y;
}

/**
 * 우타 기준: 정면에서 타겟(리드=왼발) 방향 = 화면 +x.
 * 좌타는 부호를 반대로 해석.
 */
export function isWeightShiftTowardTarget(
  signed: number,
  dominantHand: DominantHand,
): boolean {
  if (!Number.isFinite(signed) || signed === 0) {
    return false;
  }
  if (dominantHand === 'right') {
    return signed > 0;
  }
  return signed < 0;
}

/**
 * 트레일(뒤) 손목 — 우타=오른손, 좌타=왼손.
 * dominant_hand 없으면 null (양쪽 동등 표시).
 */
export function trailWristSide(
  dominantHand: DominantHand | null | undefined,
): 'left' | 'right' | null {
  if (dominantHand === 'right') {
    return 'right';
  }
  if (dominantHand === 'left') {
    return 'left';
  }
  return null;
}

/**
 * 구간 분할·관절각용 트레일 손목 인덱스.
 * 미설정 시 우타(right_wrist) — 정면 우타와 동일 기본값.
 */
export function trailWristIndexForDominantHand(
  dominantHand: DominantHand | null | undefined,
): number {
  return dominantHand === 'left'
    ? LANDMARK_INDEX.left_wrist
    : LANDMARK_INDEX.right_wrist;
}

/**
 * elbow→wrist 와 wrist→index 사이 각 (꼭짓점=wrist).
 * elbow / wrist / index 중 하나라도 visibility 미달이면 null.
 */
function wristCockingDeg(
  landmarks: PoseLandmarks,
  side: 'left' | 'right',
): number | null {
  const elbow =
    landmarks[
      side === 'left'
        ? LANDMARK_INDEX.left_elbow
        : LANDMARK_INDEX.right_elbow
    ];
  const wrist =
    landmarks[
      side === 'left'
        ? LANDMARK_INDEX.left_wrist
        : LANDMARK_INDEX.right_wrist
    ];
  const index =
    landmarks[
      side === 'left'
        ? LANDMARK_INDEX.left_index
        : LANDMARK_INDEX.right_index
    ];
  if (!isUsable(elbow) || !isUsable(wrist) || !isUsable(index)) {
    return null;
  }
  // 3D: z도 사용 (isUsable은 x/y/visibility만 검사 — z는 finite 확인)
  if (
    !Number.isFinite(elbow.z) ||
    !Number.isFinite(wrist.z) ||
    !Number.isFinite(index.z)
  ) {
    return null;
  }
  const deg = angleDegAt3D(elbow, wrist, index);
  return Number.isFinite(deg) ? round1(deg) : null;
}

export function computeMovementMetrics(
  frames: readonly LandmarkFrame[],
  phases: readonly PhaseMarker[],
  options?: MovementMetricsOptions,
): MovementMetrics {
  const empty: MovementMetrics = {
    weightShiftDelta: null,
    weightShiftSigned: null,
    weightShiftTowardTarget: null,
    headRiseDelta: null,
    leftWristCockingDeg: null,
    rightWristCockingDeg: null,
  };

  if (frames.length === 0 || phases.length === 0) {
    return empty;
  }

  const address = frameForPhase(frames, phases, 'address');
  const top = frameForPhase(frames, phases, 'top');
  const impact = frameForPhase(frames, phases, 'impact');

  let weightShiftDelta: number | null = null;
  let weightShiftSigned: number | null = null;
  let weightShiftTowardTarget: boolean | null = null;
  let headRiseDelta: number | null = null;

  if (address && top && impact) {
    const width = shoulderWidth(address.landmarks);
    if (width != null) {
      const hipTop = hipMidX(top.landmarks);
      const hipImpact = hipMidX(impact.landmarks);
      if (hipTop != null && hipImpact != null) {
        weightShiftSigned = round3((hipImpact - hipTop) / width);
        weightShiftDelta = round3(Math.abs(weightShiftSigned));
        const hand = options?.dominantHand;
        if (hand === 'right' || hand === 'left') {
          weightShiftTowardTarget = isWeightShiftTowardTarget(
            weightShiftSigned,
            hand,
          );
        }
      }

      const noseAddress = noseY(address.landmarks);
      const noseImpact = noseY(impact.landmarks);
      if (noseAddress != null && noseImpact != null) {
        headRiseDelta = round3(Math.abs(noseAddress - noseImpact) / width);
      }
    }
  }

  let leftWristCockingDeg: number | null = null;
  let rightWristCockingDeg: number | null = null;
  if (top) {
    leftWristCockingDeg = wristCockingDeg(top.landmarks, 'left');
    rightWristCockingDeg = wristCockingDeg(top.landmarks, 'right');
  }

  return {
    weightShiftDelta,
    weightShiftSigned,
    weightShiftTowardTarget,
    headRiseDelta,
    leftWristCockingDeg,
    rightWristCockingDeg,
  };
}

/** 이동량 크기 구간 라벨 — 판정 문구 아님 */
export function movementDeltaBandLabel(
  delta: number | null,
): string | null {
  if (delta == null || !Number.isFinite(delta)) {
    return null;
  }
  if (delta < MOVEMENT_DELTA_SMALL) {
    return '작은 이동';
  }
  if (delta < MOVEMENT_DELTA_MEDIUM) {
    return '보통 이동';
  }
  return '큰 이동';
}
