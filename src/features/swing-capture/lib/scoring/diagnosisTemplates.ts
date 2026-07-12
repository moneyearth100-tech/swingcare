/**
 * 규칙 기반 스윙 인사이트 템플릿 (Claude API 미사용).
 *
 * 2장 가드레일: "부상"·"위험"·"진단"(의료) 등 금지.
 * 허용: 밸런스 지수, 컨디셔닝 인사이트, 자세 안내, 웰니스.
 */

import type { PhaseMarker, SwingPhase } from '../landmarkTypes';

import type {
  BalanceScoreJoint,
  BalanceScoreResult,
} from './balanceScore';
import {
  SCORE_BAND_CAUTION,
  SCORE_BAND_GOOD,
} from './balanceScoreConstants';

/** 패턴 ID → 추천 드릴 (drills 테이블 연동 전 문자열 ID) */
export type DiagnosisPatternId =
  | 'over_the_top'
  | 'impact_weight_shift'
  | 'early_extension'
  | 'overall_good';

export interface DiagnosisTemplate {
  id: DiagnosisPatternId;
  /** 리포트 태그용 짧은 제목 (문제 구간 · …) */
  tagLabel: string;
  /** diagnosis-box 본문 */
  body: string;
  recommendedDrillId: string;
}

/**
 * 목업 `#detail-report` diagnosis-box + 추가 시작 세트.
 * 문구 검수: 부상/위험/진단(의료) 미포함.
 */
export const DIAGNOSIS_TEMPLATES: Record<
  DiagnosisPatternId,
  DiagnosisTemplate
> = {
  over_the_top: {
    id: 'over_the_top',
    tagLabel: '문제 구간 · 다운스윙 초반',
    // swingcare_app_mockup_aurora.html diagnosis-box 문구 그대로
    body: '상체가 먼저 열리며 클럽이 아웃사이드로 빠지는 오버 더 탑 패턴이 감지됐어요. 힙 리드로 다운스윙을 시작하는 연습이 필요해요.',
    recommendedDrillId: 'drill_towel_hip_lead',
  },
  impact_weight_shift: {
    id: 'impact_weight_shift',
    tagLabel: '문제 구간 · 임팩트',
    body: '임팩트 구간에서 하체 리드가 약해 체중이 앞쪽으로 충분히 넘어가지 않는 패턴이 보여요. 스텝 스루로 밸런스를 맞춰 보는 연습이 도움이 됩니다.',
    recommendedDrillId: 'drill_step_weight_transfer',
  },
  early_extension: {
    id: 'early_extension',
    tagLabel: '문제 구간 · 다운스윙~임팩트',
    body: '다운스윙에서 골반이 일찍 일어서며 자세 각이 풀리는 얼리 익스텐션 패턴이 감지됐어요. 벽 터치로 척추 각을 유지하는 컨디셔닝 연습이 좋아요.',
    recommendedDrillId: 'drill_wall_posture',
  },
  overall_good: {
    id: 'overall_good',
    tagLabel: '컨디셔닝 인사이트',
    body: '전반적으로 양호한 패턴이에요. 특정 구간에서 크게 흔들린 지점은 보이지 않으니, 오늘 리듬을 그대로 유지해 보세요.',
    recommendedDrillId: 'drill_smooth_tempo',
  },
};

export interface WorstPhaseJoint {
  phase: SwingPhase;
  joint: BalanceScoreJoint;
  score: number;
}

export interface DiagnosisMatchResult {
  patternId: DiagnosisPatternId;
  template: DiagnosisTemplate;
  /** DB issue_phase — overall_good이면 null */
  issuePhase: SwingPhase | null;
  worst: WorstPhaseJoint | null;
}

/** 관절·구간 중 밸런스 점수가 가장 낮은 곳 */
export function findWorstPhaseJoint(
  balanceScore: BalanceScoreResult,
): WorstPhaseJoint | null {
  let worst: WorstPhaseJoint | null = null;
  for (const joint of Object.keys(
    balanceScore.joints,
  ) as BalanceScoreJoint[]) {
    const phaseScores = balanceScore.joints[joint].phaseScores;
    for (const phase of Object.keys(phaseScores) as SwingPhase[]) {
      const score = phaseScores[phase];
      if (score == null || !Number.isFinite(score)) {
        continue;
      }
      if (worst == null || score < worst.score) {
        worst = { phase, joint, score };
      }
    }
  }
  return worst;
}

/**
 * phases + 관절별 밸런스 점수 → 템플릿 매칭.
 * phases는 향후 확장용(현재는 balanceScore.phaseScores가 구간 기준).
 */
export function matchDiagnosis(
  balanceScore: BalanceScoreResult,
  _phases: readonly PhaseMarker[],
): DiagnosisMatchResult {
  const worst = findWorstPhaseJoint(balanceScore);
  const overall = balanceScore.overallScore;

  if (
    worst == null ||
    (overall >= SCORE_BAND_GOOD && worst.score >= SCORE_BAND_CAUTION + 10)
  ) {
    const template = DIAGNOSIS_TEMPLATES.overall_good;
    return {
      patternId: template.id,
      template,
      issuePhase: null,
      worst,
    };
  }

  let patternId: DiagnosisPatternId;
  if (worst.phase === 'mid_downswing') {
    // 다운스윙 초반: 상체 오픈(OTT) vs 얼리 익스텐션(허리 점수 매우 낮음)
    if (worst.joint === 'lower_back' && worst.score < SCORE_BAND_CAUTION - 5) {
      patternId = 'early_extension';
    } else {
      patternId = 'over_the_top';
    }
  } else if (worst.phase === 'impact') {
    if (worst.joint === 'lower_back' && worst.score < SCORE_BAND_CAUTION - 5) {
      patternId = 'early_extension';
    } else {
      patternId = 'impact_weight_shift';
    }
  } else if (
    worst.phase === 'top' ||
    worst.phase === 'mid_backswing' ||
    worst.phase === 'toe_up'
  ) {
    patternId = 'over_the_top';
  } else if (worst.joint === 'lower_back') {
    patternId = 'early_extension';
  } else if (worst.joint === 'knee') {
    patternId = 'impact_weight_shift';
  } else if (worst.score >= SCORE_BAND_CAUTION) {
    patternId = 'overall_good';
  } else {
    // address / finish / follow 등 — 기본은 다운스윙 초반 패턴으로 안내
    patternId = 'over_the_top';
  }

  const template = DIAGNOSIS_TEMPLATES[patternId];
  return {
    patternId,
    template,
    issuePhase: patternId === 'overall_good' ? null : worst.phase,
    worst,
  };
}

/** 가드레일용 — 템플릿 전체 문자열 */
export function allDiagnosisTemplateLiterals(): string[] {
  return Object.values(DIAGNOSIS_TEMPLATES).flatMap((t) => [
    t.tagLabel,
    t.body,
    t.recommendedDrillId,
  ]);
}
