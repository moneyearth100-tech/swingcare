/**
 * 스윙 밸런스 지수 계산 (마스터스펙 6.2 재구성안).
 *
 * 입력: LandmarkFrame[] + PhaseMarker[]
 * 출력: 종합 0~100 + 관절별 점수 (편차↑ → 점수↓)
 *
 * ⚠️ 계수·참조각은 balanceScoreConstants — 스포츠의학 자문 후 재조정 필요
 */

import type {
  LandmarkFrame,
  PhaseMarker,
  SwingPhase,
} from '../landmarkTypes';
import { SWING_PHASES } from '../landmarkTypes';

import { jointAngleFromFrame } from './jointAngles';
import {
  JOINT_WEIGHTS,
  BALANCE_SCORE_JOINTS,
  BALANCE_SCORE_VERSION,
  JOINT_LABEL_KO,
  MAX_DEVIATION_DEG,
  PHASE_WEIGHTS,
  REFERENCE_ANGLE_DEG,
  SCORE_BAND_CAUTION,
  SCORE_BAND_GOOD,
  type BalanceScoreJoint,
} from './balanceScoreConstants';
import {
  computeMovementMetrics,
  type DominantHand,
  type MovementMetrics,
} from './movementMetrics';

export type { BalanceScoreJoint } from './balanceScoreConstants';
export type { DominantHand, MovementMetrics } from './movementMetrics';
export {
  BALANCE_SCORE_VERSION,
  JOINT_LABEL_KO,
  SCORE_BAND_CAUTION,
  SCORE_BAND_GOOD,
};

export type BalanceScoreOptions = {
  dominantHand?: DominantHand | null;
};

export interface JointBalanceScore {
  joint: BalanceScoreJoint;
  score: number;
  /** 구간별 기여 (디버그) */
  phaseScores: Partial<Record<SwingPhase, number>>;
  sampleCount: number;
}

export interface BalanceScoreResult {
  version: string;
  overallScore: number;
  joints: Record<BalanceScoreJoint, JointBalanceScore>;
  /** load_score_v2 이동·코킹 지표 */
  movementMetrics: MovementMetrics;
  /** 점수를 거의 못 뽑은 경우 안내 */
  warning: string | null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 편차(도) → 0~100 (편차 클수록 낮음) */
export function deviationToScore(
  deviationDeg: number,
  maxDeviationDeg: number,
): number {
  if (!Number.isFinite(deviationDeg) || maxDeviationDeg <= 0) {
    return 0;
  }
  return 100 * (1 - clamp01(Math.abs(deviationDeg) / maxDeviationDeg));
}

function phaseWindows(
  phases: readonly PhaseMarker[],
  frames: readonly LandmarkFrame[],
): { phase: SwingPhase; startMs: number; endMs: number }[] {
  if (phases.length === 0 || frames.length === 0) {
    return [];
  }
  const ordered = [...phases].sort((a, b) => a.timestampMs - b.timestampMs);
  const lastMs = frames[frames.length - 1]?.timestampMs ?? ordered[ordered.length - 1].timestampMs;
  const windows: { phase: SwingPhase; startMs: number; endMs: number }[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const startMs = ordered[i].timestampMs;
    const endMs =
      i + 1 < ordered.length ? ordered[i + 1].timestampMs : lastMs + 1;
    windows.push({ phase: ordered[i].phase, startMs, endMs });
  }
  return windows;
}

function framesInWindow(
  frames: readonly LandmarkFrame[],
  startMs: number,
  endMs: number,
): LandmarkFrame[] {
  return frames.filter(
    (f) => f.timestampMs >= startMs && f.timestampMs < endMs,
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * phases + frames → 밸런스 지수.
 * 세션 저장과 무관 — 호출측에서 표시/영속화 결정.
 */
export function computeBalanceScore(
  frames: readonly LandmarkFrame[],
  phases: readonly PhaseMarker[],
  options?: BalanceScoreOptions,
): BalanceScoreResult {
  const windows = phaseWindows(phases, frames);
  const joints = {} as Record<BalanceScoreJoint, JointBalanceScore>;
  let totalSamples = 0;

  for (const joint of BALANCE_SCORE_JOINTS) {
    const phaseScores: Partial<Record<SwingPhase, number>> = {};
    let weightedSum = 0;
    let weightSum = 0;
    let sampleCount = 0;

    for (const window of windows) {
      const ref = REFERENCE_ANGLE_DEG[joint][window.phase];
      if (ref == null) {
        continue;
      }
      const slice = framesInWindow(frames, window.startMs, window.endMs);
      const angles: number[] = [];
      for (const frame of slice) {
        const angle = jointAngleFromFrame(frame, joint);
        if (angle != null) {
          angles.push(angle);
        }
      }
      const avg = mean(angles);
      if (avg == null) {
        continue;
      }
      const score = deviationToScore(
        avg - ref,
        MAX_DEVIATION_DEG[joint],
      );
      phaseScores[window.phase] = round1(score);
      const w = PHASE_WEIGHTS[window.phase] ?? 1;
      weightedSum += score * w;
      weightSum += w;
      sampleCount += angles.length;
    }

    const jointScore = weightSum > 0 ? weightedSum / weightSum : 0;
    totalSamples += sampleCount;
    joints[joint] = {
      joint,
      score: round1(jointScore),
      phaseScores,
      sampleCount,
    };
  }

  let overallWeighted = 0;
  let overallWeight = 0;
  for (const joint of BALANCE_SCORE_JOINTS) {
    if (joints[joint].sampleCount === 0) {
      continue;
    }
    const w = JOINT_WEIGHTS[joint];
    overallWeighted += joints[joint].score * w;
    overallWeight += w;
  }

  const overallScore =
    overallWeight > 0 ? round1(overallWeighted / overallWeight) : 0;

  let warning: string | null = null;
  if (frames.length === 0 || phases.length === 0) {
    warning = '프레임 또는 구간 마커가 없어 점수를 계산하지 못했습니다.';
  } else if (totalSamples < 8) {
    warning = '각도 샘플이 적어 점수 신뢰도가 낮을 수 있습니다.';
  } else if (phases.length < SWING_PHASES.length) {
    warning = '일부 구간 마커가 빠져 가중 평균이 편향될 수 있습니다.';
  }

  return {
    version: BALANCE_SCORE_VERSION,
    overallScore,
    joints,
    movementMetrics: computeMovementMetrics(frames, phases, options),
    warning,
  };
}

/** TEMP 오버레이/로그용 한 줄 요약 */
export function formatBalanceScoreSummary(result: BalanceScoreResult): string {
  const parts = BALANCE_SCORE_JOINTS.map((j) => {
    return `${JOINT_LABEL_KO[j]} ${result.joints[j].score}`;
  });
  return `종합 ${result.overallScore} · ${parts.join(' · ')}`;
}
