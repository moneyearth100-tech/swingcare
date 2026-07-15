/**
 * phaseSegmentation 샘플 시퀀스 스모크 체크 (의존성 없이 node로 실행 가능하도록 로직만).
 * 실행: npx --yes tsx src/features/swing-capture/lib/phaseSegmentation.sampleCheck.ts
 */

import type { Landmark, LandmarkFrame } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT, LANDMARK_INDEX } from './landmarkTypes';
import { segmentSwingPhases } from './phaseSegmentation';

function blankPose(): Landmark[] {
  return Array.from({ length: BLAZEPOSE_LANDMARK_COUNT }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 1,
  }));
}

function withWristY(y: number, x = 0.55): Landmark[] {
  const pose = blankPose();
  const wrist = LANDMARK_INDEX.right_wrist;
  pose[wrist] = { x, y, z: 0, visibility: 1 };
  return pose;
}

/** 우타 다운스윙을 단순화한 y 궤적 (address → top↑ → impact 빠른 하강 → finish) */
function buildSyntheticSwing(frameCount = 60, fps = 30): LandmarkFrame[] {
  const frames: LandmarkFrame[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / (frameCount - 1);
    let y: number;
    let x = 0.55;
    if (t < 0.35) {
      // address → top: y 감소(상승)
      const u = t / 0.35;
      y = 0.72 - u * 0.45;
      x = 0.55 + u * 0.05;
    } else if (t < 0.55) {
      // top → impact: 급격한 하강 + x 이동
      const u = (t - 0.35) / 0.2;
      y = 0.27 + u * 0.5;
      x = 0.6 - u * 0.25;
    } else {
      // follow → finish: 감속
      const u = (t - 0.55) / 0.45;
      y = 0.77 + u * 0.05;
      x = 0.35 + u * 0.05;
    }
    frames.push({
      timestampMs: Math.round(i * (1000 / fps)),
      landmarks: withWristY(y, x),
    });
  }
  return frames;
}

function phaseTime(
  frames: LandmarkFrame[],
  phase: 'top' | 'impact' | 'finish',
): number {
  const marker = segmentSwingPhases(frames).phases.find((p) => p.phase === phase);
  if (!marker) {
    throw new Error(`missing ${phase}`);
  }
  return marker.timestampMs;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const frames = buildSyntheticSwing(60);
  const { phases, warning } = segmentSwingPhases(frames);

  assert(phases.length === 8, `expected 8 phases, got ${phases.length}`);

  const byPhase = Object.fromEntries(phases.map((p) => [p.phase, p]));
  assert(byPhase.address.source === 'detected', 'address must be detected');
  assert(byPhase.top.source === 'detected', 'top must be detected');
  assert(byPhase.impact.source === 'detected', 'impact must be detected');
  assert(byPhase.finish.source === 'detected', 'finish must be detected');
  assert(byPhase.toe_up.source === 'interpolated', 'toe_up interpolated');
  assert(
    byPhase.mid_backswing.source === 'interpolated',
    'mid_backswing interpolated',
  );
  assert(
    byPhase.mid_downswing.source === 'interpolated',
    'mid_downswing interpolated',
  );
  assert(
    byPhase.mid_follow_through.source === 'interpolated',
    'mid_follow_through interpolated',
  );

  assert(
    byPhase.address.timestampMs <= byPhase.toe_up.timestampMs &&
      byPhase.toe_up.timestampMs <= byPhase.mid_backswing.timestampMs &&
      byPhase.mid_backswing.timestampMs <= byPhase.top.timestampMs &&
      byPhase.top.timestampMs <= byPhase.mid_downswing.timestampMs &&
      byPhase.mid_downswing.timestampMs <= byPhase.impact.timestampMs &&
      byPhase.impact.timestampMs <= byPhase.mid_follow_through.timestampMs &&
      byPhase.mid_follow_through.timestampMs <= byPhase.finish.timestampMs,
    'phase timestamps must be non-decreasing',
  );

  // top이 address보다 위(작은 y) 구간에 있어야 함
  assert(byPhase.top.frameIndex > byPhase.address.frameIndex, 'top after address');
  assert(
    byPhase.impact.frameIndex > byPhase.top.frameIndex,
    'impact after top',
  );

  // 피니시에서 손이 탑보다 더 높아져도 영상 끝을 top으로 오인하면 안 된다.
  const highFinish = buildSyntheticSwing(60);
  for (let i = 42; i < highFinish.length; i += 1) {
    const u = (i - 42) / (highFinish.length - 1 - 42);
    highFinish[i].landmarks = withWristY(0.65 - u * 0.55, 0.4 + u * 0.15);
  }
  assert(
    phaseTime(highFinish, 'top') < highFinish[42].timestampMs,
    'top must stay before follow-through even when finish wrist is highest',
  );

  // 같은 2초 동작을 업로드 분석 범위(10~15fps)로 샘플링해도 앵커가 크게 흔들리지 않아야 한다.
  const at10Fps = buildSyntheticSwing(21, 10);
  const at15Fps = buildSyntheticSwing(31, 15);
  for (const phase of ['top', 'impact', 'finish'] as const) {
    const drift = Math.abs(
      phaseTime(at10Fps, phase) - phaseTime(at15Fps, phase),
    );
    assert(drift <= 150, `${phase} drift too large across 10/15fps: ${drift}ms`);
  }

  console.log('[phaseSegmentation.sampleCheck] ok', {
    warning,
    phases: phases.map((p) => ({
      phase: p.phase,
      t: p.timestampMs,
      i: p.frameIndex,
      source: p.source,
    })),
  });
}

main();
