/**
 * balanceScore 스모크 체크 — npx tsx 로 실행 가능.
 * 합성 프레임으로 점수가 유한·0~100 범위인지 확인.
 */

import type { Landmark, LandmarkFrame, PhaseMarker } from '../landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT, LANDMARK_INDEX } from '../landmarkTypes';

import { computeBalanceScore } from './balanceScore';
import { BALANCE_SCORE_JOINTS } from './balanceScoreConstants';
import { matchDiagnosis, parseDiagnosisText } from './diagnosisTemplates';

function lm(x: number, y: number, z = 0, visibility = 0.9): Landmark {
  return { x, y, z, visibility };
}

function blankPose(): Landmark[] {
  return Array.from({ length: BLAZEPOSE_LANDMARK_COUNT }, () =>
    lm(0.5, 0.5, 0, 0.1),
  );
}

function poseAt(t: number): Landmark[] {
  const landmarks = blankPose();
  const lean = 0.02 * Math.sin(t * Math.PI);
  landmarks[LANDMARK_INDEX.nose] = lm(0.5, 0.18 - 0.01 * t);
  landmarks[LANDMARK_INDEX.left_shoulder] = lm(0.4, 0.28);
  landmarks[LANDMARK_INDEX.right_shoulder] = lm(0.6, 0.28);
  landmarks[LANDMARK_INDEX.left_hip] = lm(0.42, 0.5 + lean);
  landmarks[LANDMARK_INDEX.right_hip] = lm(0.58, 0.5 + lean);
  landmarks[LANDMARK_INDEX.left_knee] = lm(0.43, 0.7);
  landmarks[LANDMARK_INDEX.right_knee] = lm(0.57, 0.7);
  landmarks[LANDMARK_INDEX.left_ankle] = lm(0.43, 0.88);
  landmarks[LANDMARK_INDEX.right_ankle] = lm(0.57, 0.88);
  landmarks[LANDMARK_INDEX.left_elbow] = lm(0.32, 0.4);
  landmarks[LANDMARK_INDEX.right_elbow] = lm(0.68, 0.35 - 0.05 * t);
  landmarks[LANDMARK_INDEX.left_wrist] = lm(0.28, 0.52, -0.05);
  landmarks[LANDMARK_INDEX.right_wrist] = lm(0.72, 0.25 + 0.4 * t, -0.08);
  landmarks[LANDMARK_INDEX.left_index] = lm(0.26, 0.58, -0.1);
  landmarks[LANDMARK_INDEX.right_index] = lm(0.74, 0.2 + 0.4 * t, -0.12);
  return landmarks;
}

function buildSynthetic(): {
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
} {
  const frames: LandmarkFrame[] = [];
  for (let i = 0; i < 48; i += 1) {
    const t = i / 47;
    frames.push({ timestampMs: i * 33, landmarks: poseAt(t) });
  }
  const phaseNames = [
    'address',
    'toe_up',
    'mid_backswing',
    'top',
    'mid_downswing',
    'impact',
    'mid_follow_through',
    'finish',
  ] as const;
  const phases: PhaseMarker[] = phaseNames.map((phase, index) => {
    const frameIndex = Math.round((index / 7) * (frames.length - 1));
    return {
      phase,
      frameIndex,
      timestampMs: frames[frameIndex].timestampMs,
      source: 'detected' as const,
    };
  });
  return { frames, phases };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

const { frames, phases } = buildSynthetic();
const result = computeBalanceScore(frames, phases);

assert(result.version === 'load_score_v2', `version: ${result.version}`);
assert(
  result.overallScore >= 0 && result.overallScore <= 100,
  `overall out of range: ${result.overallScore}`,
);
for (const joint of BALANCE_SCORE_JOINTS) {
  const s = result.joints[joint].score;
  assert(s >= 0 && s <= 100, `${joint} out of range: ${s}`);
  assert(result.joints[joint].sampleCount > 0, `${joint} no samples`);
}

assert(
  result.movementMetrics.weightShiftDelta != null,
  'weightShiftDelta null',
);
assert(result.movementMetrics.headRiseDelta != null, 'headRiseDelta null');
assert(
  result.movementMetrics.rightWristCockingDeg != null,
  'rightWristCockingDeg null',
);

console.log('[balanceScore.sampleCheck]', {
  overall: result.overallScore,
  joints: Object.fromEntries(
    BALANCE_SCORE_JOINTS.map((j) => [j, result.joints[j].score]),
  ),
  movement: result.movementMetrics,
  warning: result.warning,
});

const diagnosis = matchDiagnosis(result, phases);
const parsed = parseDiagnosisText(diagnosis.diagnosisText);
assert(parsed.summary.length > 0, 'diagnosis summary empty');
assert(parsed.facts.length >= 1, 'diagnosis facts empty');
assert(parsed.next != null && parsed.next.length > 0, 'diagnosis next empty');
console.log('[diagnosis.sampleCheck]', {
  pattern: diagnosis.patternId,
  summary: parsed.summary,
  facts: parsed.facts,
  next: parsed.next,
});
console.log('OK');
