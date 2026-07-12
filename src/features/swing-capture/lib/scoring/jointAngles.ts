/**
 * BlazePose 2D 랜드마크로 관절 각도(도) 근사.
 * 영상 평면 각도 — 3D 관절각이 아님.
 */

import type { Landmark, LandmarkFrame, PoseLandmarks } from '../landmarkTypes';
import { LANDMARK_INDEX } from '../landmarkTypes';

import {
  MIN_LANDMARK_VISIBILITY,
  type BalanceScoreJoint,
} from './balanceScoreConstants';

function isUsable(point: Landmark | undefined): point is Landmark {
  return (
    point != null &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.visibility >= MIN_LANDMARK_VISIBILITY
  );
}

/** 세 점으로 끼인 각 (b가 꼭짓점), 도 단위 0~180 */
export function angleDegAt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const dot = bax * bcx + bay * bcy;
  const magBA = Math.hypot(bax, bay);
  const magBC = Math.hypot(bcx, bcy);
  if (magBA < 1e-8 || magBC < 1e-8) {
    return NaN;
  }
  const cos = Math.min(1, Math.max(-1, dot / (magBA * magBC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function mid(
  a: Landmark,
  b: Landmark,
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function averageFinite(values: number[]): number | null {
  const ok = values.filter((v) => Number.isFinite(v));
  if (ok.length === 0) {
    return null;
  }
  return ok.reduce((s, v) => s + v, 0) / ok.length;
}

/**
 * 허리: 어깨 중점–엉덩이 중점–무릎 중점 각도 (몸통–하지 연결 근사)
 */
function lowerBackAngle(landmarks: PoseLandmarks): number | null {
  const ls = landmarks[LANDMARK_INDEX.left_shoulder];
  const rs = landmarks[LANDMARK_INDEX.right_shoulder];
  const lh = landmarks[LANDMARK_INDEX.left_hip];
  const rh = landmarks[LANDMARK_INDEX.right_hip];
  const lk = landmarks[LANDMARK_INDEX.left_knee];
  const rk = landmarks[LANDMARK_INDEX.right_knee];
  if (
    !isUsable(ls) ||
    !isUsable(rs) ||
    !isUsable(lh) ||
    !isUsable(rh) ||
    !isUsable(lk) ||
    !isUsable(rk)
  ) {
    return null;
  }
  return angleDegAt(mid(ls, rs), mid(lh, rh), mid(lk, rk));
}

/**
 * 손목: 어깨–팔꿈치–손목 (좌우 평균, 우타 트레일/리드 모두 반영)
 */
function wristAngle(landmarks: PoseLandmarks): number | null {
  const values: number[] = [];
  const ls = landmarks[LANDMARK_INDEX.left_shoulder];
  const le = landmarks[LANDMARK_INDEX.left_elbow];
  const lw = landmarks[LANDMARK_INDEX.left_wrist];
  const rs = landmarks[LANDMARK_INDEX.right_shoulder];
  const re = landmarks[LANDMARK_INDEX.right_elbow];
  const rw = landmarks[LANDMARK_INDEX.right_wrist];

  if (isUsable(ls) && isUsable(le) && isUsable(lw)) {
    values.push(angleDegAt(ls, le, lw));
  }
  if (isUsable(rs) && isUsable(re) && isUsable(rw)) {
    values.push(angleDegAt(rs, re, rw));
  }
  return averageFinite(values);
}

/**
 * 무릎: 엉덩이–무릎–발목 (좌우 평균)
 */
function kneeAngle(landmarks: PoseLandmarks): number | null {
  const values: number[] = [];
  const pairs: [number, number, number][] = [
    [
      LANDMARK_INDEX.left_hip,
      LANDMARK_INDEX.left_knee,
      LANDMARK_INDEX.left_ankle,
    ],
    [
      LANDMARK_INDEX.right_hip,
      LANDMARK_INDEX.right_knee,
      LANDMARK_INDEX.right_ankle,
    ],
  ];
  for (const [hi, ki, ai] of pairs) {
    const h = landmarks[hi];
    const k = landmarks[ki];
    const a = landmarks[ai];
    if (isUsable(h) && isUsable(k) && isUsable(a)) {
      values.push(angleDegAt(h, k, a));
    }
  }
  return averageFinite(values);
}

export function jointAngleDeg(
  landmarks: PoseLandmarks,
  joint: BalanceScoreJoint,
): number | null {
  switch (joint) {
    case 'lower_back':
      return lowerBackAngle(landmarks);
    case 'wrist':
      return wristAngle(landmarks);
    case 'knee':
      return kneeAngle(landmarks);
    default: {
      const _exhaustive: never = joint;
      return _exhaustive;
    }
  }
}

export function jointAngleFromFrame(
  frame: LandmarkFrame,
  joint: BalanceScoreJoint,
): number | null {
  return jointAngleDeg(frame.landmarks, joint);
}
