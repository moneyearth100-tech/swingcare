/**
 * 규칙 기반 스윙 인사이트 (Claude API 미사용).
 *
 * 구조: 요약 1줄 + 근거 팩트(수치) 최대 3개 + 다음 행동 1줄.
 * 2장 가드레일: "부상"·"위험"·"진단"(의료)·"부족해요" 등 단정 금지.
 */

import type { PhaseMarker, SwingPhase } from '../landmarkTypes';

import type {
  BalanceScoreJoint,
  BalanceScoreResult,
} from './balanceScore';
import {
  JOINT_LABEL_KO,
  MOVEMENT_DELTA_MEDIUM,
  MOVEMENT_DELTA_SMALL,
  SCORE_BAND_CAUTION,
  SCORE_BAND_GOOD,
} from './balanceScoreConstants';
import {
  movementDeltaBandLabel,
  type MovementMetrics,
} from './movementMetrics';

/** 패턴 ID → 추천 드릴 (drills 테이블 연동 전 문자열 ID) */
export type DiagnosisPatternId =
  | 'over_the_top'
  | 'impact_weight_shift'
  | 'early_extension'
  | 'overall_good';

export interface DiagnosisTemplate {
  id: DiagnosisPatternId;
  /** 리포트 태그용 짧은 제목 */
  tagLabel: string;
  /** 요약 한 줄 (패턴 공통 골격 — 숫자는 match 시 채움) */
  summaryHint: string;
  /** 드릴과 연결되는 다음 행동 한 줄 */
  drillLine: string;
  recommendedDrillId: string;
  /**
   * @deprecated 하위 호환 — formatDiagnosisText 결과로 덮어씀
   */
  body: string;
}

export const PHASE_LABEL_KO: Record<SwingPhase, string> = {
  address: '어드레스',
  toe_up: '토우업',
  mid_backswing: '백스윙중',
  top: '탑',
  mid_downswing: '다운스윙 초반',
  impact: '임팩트',
  mid_follow_through: '팔로우중',
  finish: '피니시',
};

/**
 * 패턴별 슬롯. 본문은 matchDiagnosis에서 수치와 조합.
 */
export const DIAGNOSIS_TEMPLATES: Record<
  DiagnosisPatternId,
  DiagnosisTemplate
> = {
  over_the_top: {
    id: 'over_the_top',
    tagLabel: '살펴볼 구간 · 다운스윙 초반',
    summaryHint:
      '상체가 하체보다 앞서 열리는 쪽 패턴을 살펴볼 만해요.',
    drillLine:
      '다음: 힙 리드로 다운스윙을 시작하는 타월 드릴을 이어서 해보세요.',
    recommendedDrillId: 'drill_towel_hip_lead',
    body: '',
  },
  impact_weight_shift: {
    id: 'impact_weight_shift',
    tagLabel: '살펴볼 구간 · 임팩트',
    summaryHint:
      '임팩트 전후 하체 리드·체중 이동 쪽을 함께 보면 좋아요.',
    drillLine:
      '다음: 스텝 스루로 밸런스 감각을 맞춰 보는 드릴을 이어서 해보세요.',
    recommendedDrillId: 'drill_step_weight_transfer',
    body: '',
  },
  early_extension: {
    id: 'early_extension',
    tagLabel: '살펴볼 구간 · 다운스윙~임팩트',
    summaryHint:
      '다운스윙에서 골반·몸통 각이 일찍 풀리는 쪽 패턴을 살펴볼 만해요.',
    drillLine:
      '다음: 벽 터치로 척추 각을 유지하는 컨디셔닝을 이어서 해보세요.',
    recommendedDrillId: 'drill_wall_posture',
    body: '',
  },
  overall_good: {
    id: 'overall_good',
    tagLabel: '컨디셔닝 인사이트',
    summaryHint:
      '특정 구간에서 크게 흔들린 지점은 보이지 않아요. 오늘 리듬을 유지해 보세요.',
    drillLine: '다음: 부드러운 템포를 유지하는 드릴로 감각을 이어가 보세요.',
    recommendedDrillId: 'drill_smooth_tempo',
    body: '',
  },
};

export interface DiagnosisFact {
  /** 안정적 id (디버그·테스트) */
  id: string;
  /** 한 줄 근거 (수치 포함) */
  text: string;
}

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
  /** 요약 1줄 */
  summary: string;
  /** 근거 팩트 (최대 3) */
  facts: DiagnosisFact[];
  /** 다음 행동 1줄 */
  drillLine: string;
  /** DB diagnosis_text 저장용 조합 본문 */
  diagnosisText: string;
}

const FACT_MARK = '[근거]';
const NEXT_MARK = '[다음]';

/** 관절·구간 점수 낮은 순 */
export function findLowestPhaseJoints(
  balanceScore: BalanceScoreResult,
  limit = 3,
): WorstPhaseJoint[] {
  const cells: WorstPhaseJoint[] = [];
  for (const joint of Object.keys(
    balanceScore.joints,
  ) as BalanceScoreJoint[]) {
    const phaseScores = balanceScore.joints[joint].phaseScores;
    for (const phase of Object.keys(phaseScores) as SwingPhase[]) {
      const score = phaseScores[phase];
      if (score == null || !Number.isFinite(score)) {
        continue;
      }
      cells.push({ phase, joint, score });
    }
  }
  cells.sort((a, b) => a.score - b.score || a.joint.localeCompare(b.joint));
  return cells.slice(0, Math.max(0, limit));
}

export function findWorstPhaseJoint(
  balanceScore: BalanceScoreResult,
): WorstPhaseJoint | null {
  return findLowestPhaseJoints(balanceScore, 1)[0] ?? null;
}

function pickPatternId(
  worst: WorstPhaseJoint | null,
  overall: number,
): DiagnosisPatternId {
  if (
    worst == null ||
    (overall >= SCORE_BAND_GOOD && worst.score >= SCORE_BAND_CAUTION + 10)
  ) {
    return 'overall_good';
  }

  if (worst.phase === 'mid_downswing') {
    if (worst.joint === 'lower_back' && worst.score < SCORE_BAND_CAUTION - 5) {
      return 'early_extension';
    }
    return 'over_the_top';
  }
  if (worst.phase === 'impact') {
    if (worst.joint === 'lower_back' && worst.score < SCORE_BAND_CAUTION - 5) {
      return 'early_extension';
    }
    return 'impact_weight_shift';
  }
  if (
    worst.phase === 'top' ||
    worst.phase === 'mid_backswing' ||
    worst.phase === 'toe_up'
  ) {
    return 'over_the_top';
  }
  if (worst.joint === 'lower_back' || worst.joint === 'hip') {
    return 'early_extension';
  }
  if (worst.joint === 'knee') {
    return 'impact_weight_shift';
  }
  if (worst.joint === 'shoulder') {
    return 'over_the_top';
  }
  if (worst.score >= SCORE_BAND_CAUTION) {
    return 'overall_good';
  }
  return 'over_the_top';
}

function phaseJointFact(cell: WorstPhaseJoint): DiagnosisFact {
  const phaseKo = PHASE_LABEL_KO[cell.phase];
  const jointKo = JOINT_LABEL_KO[cell.joint];
  return {
    id: `phase:${cell.phase}:${cell.joint}`,
    text: `${phaseKo} · ${jointKo} ${round1(cell.score)}점 (구간별)`,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function movementFacts(metrics: MovementMetrics | undefined): DiagnosisFact[] {
  if (!metrics) {
    return [];
  }
  const out: DiagnosisFact[] = [];
  const ws = metrics.weightShiftDelta;
  if (ws != null && Number.isFinite(ws)) {
    const band = movementDeltaBandLabel(ws);
    const notable = ws < MOVEMENT_DELTA_SMALL || ws >= MOVEMENT_DELTA_MEDIUM;
    if (notable || out.length === 0) {
      out.push({
        id: 'move:weightShift',
        text: `체중 이동량 ${ws.toFixed(3)}${band ? ` · ${band}` : ''} (탑→임팩트)`,
      });
    }
  }
  const hr = metrics.headRiseDelta;
  if (hr != null && Number.isFinite(hr)) {
    const band = movementDeltaBandLabel(hr);
    const notable = hr < MOVEMENT_DELTA_SMALL || hr >= MOVEMENT_DELTA_MEDIUM;
    if (notable) {
      out.push({
        id: 'move:headRise',
        text: `머리 이동량 ${hr.toFixed(3)}${band ? ` · ${band}` : ''} (어드레스→임팩트)`,
      });
    }
  }
  // 코킹은 참고용 — 값이 있을 때만 짧게 (단정 없음)
  const cock = metrics.rightWristCockingDeg;
  if (cock != null && Number.isFinite(cock)) {
    out.push({
      id: 'move:cocking',
      text: `손목 코킹(탑·오른) ${cock.toFixed(1)}° · 참고용`,
    });
  }
  return out;
}

function buildFacts(
  balanceScore: BalanceScoreResult,
  patternId: DiagnosisPatternId,
): DiagnosisFact[] {
  const lowest = findLowestPhaseJoints(balanceScore, 5);
  const facts: DiagnosisFact[] = [];

  // 점수 근거 우선 2개
  for (const cell of lowest) {
    if (facts.length >= 2) {
      break;
    }
    // overall_good일 때는 너무 낮은 것만 아니면 상위 낮은 칸도 정보로
    if (patternId === 'overall_good' && cell.score >= SCORE_BAND_GOOD) {
      continue;
    }
    facts.push(phaseJointFact(cell));
  }

  // 이동·코킹으로 채우기 (중복 id 방지, 최대 3)
  for (const mf of movementFacts(balanceScore.movementMetrics)) {
    if (facts.length >= 3) {
      break;
    }
    if (facts.some((f) => f.id === mf.id)) {
      continue;
    }
    facts.push(mf);
  }

  // 아직 부족하면 점수 근거 추가
  for (const cell of lowest) {
    if (facts.length >= 3) {
      break;
    }
    const fact = phaseJointFact(cell);
    if (facts.some((f) => f.id === fact.id)) {
      continue;
    }
    facts.push(fact);
  }

  // overall_good + 근거 없음 → 종합만
  if (facts.length === 0) {
    facts.push({
      id: 'overall',
      text: `종합 밸런스 ${round1(balanceScore.overallScore)}점`,
    });
  }

  return facts.slice(0, 3);
}

function buildSummary(
  patternId: DiagnosisPatternId,
  overall: number,
  worst: WorstPhaseJoint | null,
): string {
  const base = DIAGNOSIS_TEMPLATES[patternId].summaryHint;
  const overallPart = `종합 ${round1(overall)}점.`;
  if (patternId === 'overall_good' || worst == null) {
    return `${overallPart} ${base}`;
  }
  const focus = `${PHASE_LABEL_KO[worst.phase]} ${JOINT_LABEL_KO[worst.joint]}(${round1(worst.score)})이 상대적으로 낮아요.`;
  return `${overallPart} ${focus} ${base}`;
}

/** DB·홈 피드용 단일 문자열 */
export function formatDiagnosisText(input: {
  summary: string;
  facts: DiagnosisFact[];
  drillLine: string;
}): string {
  const lines = [
    input.summary.trim(),
    '',
    FACT_MARK,
    ...input.facts.map((f) => `· ${f.text}`),
    '',
    NEXT_MARK,
    input.drillLine.trim(),
  ];
  return lines.join('\n');
}

export interface ParsedDiagnosisText {
  summary: string;
  facts: string[];
  next: string | null;
  /** 구형 단일 문단 여부 */
  legacy: boolean;
}

/** 리포트 UI용 파서 — 구형 본문도 허용 */
export function parseDiagnosisText(
  text: string | null | undefined,
): ParsedDiagnosisText {
  const raw = text?.trim() ?? '';
  if (!raw) {
    return { summary: '', facts: [], next: null, legacy: true };
  }
  if (!raw.includes(FACT_MARK)) {
    return { summary: raw, facts: [], next: null, legacy: true };
  }

  const factIdx = raw.indexOf(FACT_MARK);
  const nextIdx = raw.indexOf(NEXT_MARK);
  const summary = raw.slice(0, factIdx).trim();
  const factBlock =
    nextIdx >= 0
      ? raw.slice(factIdx + FACT_MARK.length, nextIdx)
      : raw.slice(factIdx + FACT_MARK.length);
  const facts = factBlock
    .split('\n')
    .map((l) => l.replace(/^[·•\-\*]\s*/, '').trim())
    .filter(Boolean);
  const next =
    nextIdx >= 0
      ? raw
          .slice(nextIdx + NEXT_MARK.length)
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)[0] ?? null
      : null;

  return { summary, facts, next, legacy: false };
}

/**
 * phases + 관절·이동 지표 → 요약/근거/다음 행동.
 */
export function matchDiagnosis(
  balanceScore: BalanceScoreResult,
  _phases: readonly PhaseMarker[],
): DiagnosisMatchResult {
  const worst = findWorstPhaseJoint(balanceScore);
  const overall = balanceScore.overallScore;
  const patternId = pickPatternId(worst, overall);
  const base = DIAGNOSIS_TEMPLATES[patternId];
  const summary = buildSummary(patternId, overall, worst);
  const facts = buildFacts(balanceScore, patternId);
  const drillLine = base.drillLine;
  const diagnosisText = formatDiagnosisText({ summary, facts, drillLine });

  const template: DiagnosisTemplate = {
    ...base,
    body: diagnosisText,
  };

  return {
    patternId,
    template,
    issuePhase: patternId === 'overall_good' ? null : (worst?.phase ?? null),
    worst,
    summary,
    facts,
    drillLine,
    diagnosisText,
  };
}

/** 가드레일용 — 템플릿·조합 문자열 */
export function allDiagnosisTemplateLiterals(): string[] {
  return Object.values(DIAGNOSIS_TEMPLATES).flatMap((t) => [
    t.tagLabel,
    t.summaryHint,
    t.drillLine,
    t.recommendedDrillId,
  ]);
}
