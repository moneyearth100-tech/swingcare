/**
 * BlazePose 2D 랜드마크로 관절 각도(도) 근사.
 * 영상 평면 각도 — 3D 관절각이 아님.
 * (손목 코킹만 movementMetrics에서 3D 사용)
 */

import type { Landmark, LandmarkFrame, PoseLandmarks } from '../landmarkTypes';
import { LANDMARK_INDEX } from '../landmarkTypes';

import {
  MIN_LANDMARK_VISIBILITY,
  type BalanceScoreJoint,
} from './balanceScoreConstants';

/** 주손 — movementMetrics.DominantHand 와 동일 (순환 import 방지) */
type DominantHandOpt = 'right' | 'left' | null | undefined;

export function isUsable(point: Landmark | undefined): point is Landmark {
  return (
    point != null &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.visibility >= MIN_LANDMARK_VISIBILITY
  );
}

/** 세 점으로 끼인 각 (b가 꼭짓점), 도 단위 0~180 — 2D(x,y) */
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

/** 세 점 끼인 각 — 3D(x,y,z) */
export function angleDegAt3D(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = a.z - b.z;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = c.z - b.z;
  const dot = bax * bcx + bay * bcy + baz * bcz;
  const magBA = Math.hypot(bax, bay, baz);
  const magBC = Math.hypot(bcx, bcy, bcz);
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
 * 어깨: 팔꿈치–어깨–엉덩이 (좌우 평균)
 */
function shoulderAngle(landmarks: PoseLandmarks): number | null {
  const values: number[] = [];
  const pairs: [number, number, number][] = [
    [
      LANDMARK_INDEX.left_elbow,
      LANDMARK_INDEX.left_shoulder,
      LANDMARK_INDEX.left_hip,
    ],
    [
      LANDMARK_INDEX.right_elbow,
      LANDMARK_INDEX.right_shoulder,
      LANDMARK_INDEX.right_hip,
    ],
  ];
  for (const [ei, si, hi] of pairs) {
    const e = landmarks[ei];
    const s = landmarks[si];
    const h = landmarks[hi];
    if (isUsable(e) && isUsable(s) && isUsable(h)) {
      values.push(angleDegAt(e, s, h));
    }
  }
  return averageFinite(values);
}

/**
 * 힙: 어깨–엉덩이–무릎 (좌우 평균)
 */
function hipAngle(landmarks: PoseLandmarks): number | null {
  const values: number[] = [];
  const pairs: [number, number, number][] = [
    [
      LANDMARK_INDEX.left_shoulder,
      LANDMARK_INDEX.left_hip,
      LANDMARK_INDEX.left_knee,
    ],
    [
      LANDMARK_INDEX.right_shoulder,
      LANDMARK_INDEX.right_hip,
      LANDMARK_INDEX.right_knee,
    ],
  ];
  for (const [si, hi, ki] of pairs) {
    const s = landmarks[si];
    const h = landmarks[hi];
    const k = landmarks[ki];
    if (isUsable(s) && isUsable(h) && isUsable(k)) {
      values.push(angleDegAt(s, h, k));
    }
  }
  return averageFinite(values);
}

/**
 * 손목: 어깨–팔꿈치–손목.
 * dominant_hand 있으면 트레일 팔만(좌타=왼·우타=오), 없으면 좌우 평균.
 */
function wristAngle(
  landmarks: PoseLandmarks,
  dominantHand?: DominantHandOpt,
): number | null {
  const values: number[] = [];
  const ls = landmarks[LANDMARK_INDEX.left_shoulder];
  const le = landmarks[LANDMARK_INDEX.left_elbow];
  const lw = landmarks[LANDMARK_INDEX.left_wrist];
  const rs = landmarks[LANDMARK_INDEX.right_shoulder];
  const re = landmarks[LANDMARK_INDEX.right_elbow];
  const rw = landmarks[LANDMARK_INDEX.right_wrist];

  // 미설정 시 좌우 평균(기존). 우타=오른·좌타=왼 트레일만.
  const useLeft = dominantHand == null || dominantHand === 'left';
  const useRight = dominantHand == null || dominantHand === 'right';

  if (useLeft && isUsable(ls) && isUsable(le) && isUsable(lw)) {
    values.push(angleDegAt(ls, le, lw));
  }
  if (useRight && isUsable(rs) && isUsable(re) && isUsable(rw)) {
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
  dominantHand?: DominantHandOpt,
): number | null {
  switch (joint) {
    case 'lower_back':
      return lowerBackAngle(landmarks);
    case 'shoulder':
      return shoulderAngle(landmarks);
    case 'hip':
      return hipAngle(landmarks);
    case 'wrist':
      return wristAngle(landmarks, dominantHand);
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
  dominantHand?: DominantHandOpt,
): number | null {
  return jointAngleDeg(frame.landmarks, joint, dominantHand);
}
