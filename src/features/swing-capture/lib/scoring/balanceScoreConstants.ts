/**
 * 스윙 밸런스 지수 placeholder 상수.
 *
 * ⚠️ 스포츠의학 자문 후 재조정 필요 — 6.2절 재구성안 기준.
 * 모든 기준각도·가중치·정규화 스케일은 이 파일에서만 수정한다.
 */

import type { SwingPhase } from '../landmarkTypes';

/** 점수에 포함하는 관절 (목업: 허리/손목/무릎) */
export type BalanceScoreJoint = 'lower_back' | 'wrist' | 'knee';

export const BALANCE_SCORE_JOINTS: readonly BalanceScoreJoint[] = [
  'lower_back',
  'wrist',
  'knee',
] as const;

export const BALANCE_SCORE_VERSION = 'balance_score_v1_placeholder';

/**
 * 관절별 종합 가중치 (합=1).
 * ⚠️ 스포츠의학 자문 후 재조정 필요
 */
export const JOINT_WEIGHTS: Record<BalanceScoreJoint, number> = {
  lower_back: 0.4,
  wrist: 0.3,
  knee: 0.3,
};

/**
 * 구간별 가중치 — mid_downswing·impact 상향.
 * ⚠️ 스포츠의학 자문 후 재조정 필요
 */
export const PHASE_WEIGHTS: Record<SwingPhase, number> = {
  address: 0.6,
  toe_up: 0.7,
  mid_backswing: 0.85,
  top: 1.0,
  mid_downswing: 1.35,
  impact: 1.45,
  mid_follow_through: 0.9,
  finish: 0.7,
};

/**
 * 관절·구간별 "참조 각도" 중심값 (도).
 * 2D 랜드마크 근사 — 절대 생체역학 값이 아님.
 * ⚠️ 스포츠의학 자문 후 재조정 필요
 */
export const REFERENCE_ANGLE_DEG: Record<
  BalanceScoreJoint,
  Partial<Record<SwingPhase, number>>
> = {
  lower_back: {
    address: 165,
    toe_up: 160,
    mid_backswing: 155,
    top: 150,
    mid_downswing: 145,
    impact: 155,
    mid_follow_through: 160,
    finish: 165,
  },
  wrist: {
    address: 160,
    toe_up: 140,
    mid_backswing: 120,
    top: 100,
    mid_downswing: 130,
    impact: 150,
    mid_follow_through: 155,
    finish: 160,
  },
  knee: {
    address: 165,
    toe_up: 160,
    mid_backswing: 155,
    top: 150,
    mid_downswing: 145,
    impact: 155,
    mid_follow_through: 160,
    finish: 165,
  },
};

/**
 * 편차(도)가 이 값에 도달하면 해당 구간 점수 0.
 * ⚠️ 스포츠의학 자문 후 재조정 필요
 */
export const MAX_DEVIATION_DEG: Record<BalanceScoreJoint, number> = {
  lower_back: 45,
  wrist: 55,
  knee: 40,
};

/** 각도 샘플에 필요한 최소 visibility */
export const MIN_LANDMARK_VISIBILITY = 0.35;

/**
 * 표시 구간 (가드레일 준수 라벨 — UI용, 계산과 무관).
 * 70+ 양호 / 50~69 주의 / 50 미만 낮음
 */
export const SCORE_BAND_GOOD = 70;
export const SCORE_BAND_CAUTION = 50;
