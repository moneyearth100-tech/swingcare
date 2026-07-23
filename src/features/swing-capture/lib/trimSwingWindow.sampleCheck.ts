/**
 * trimSwingWindow 스모크 체크.
 * 실행: npx --yes tsx src/features/swing-capture/lib/trimSwingWindow.sampleCheck.ts
 */

import type { Landmark, LandmarkFrame } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT, LANDMARK_INDEX } from './landmarkTypes';
import { trimSwingWindow } from './trimSwingWindow';

function blankPose(): Landmark[] {
  return Array.from({ length: BLAZEPOSE_LANDMARK_COUNT }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 1,
  }));
}

function withCoreAndWrist(
  wristY: number,
  wristX = 0.55,
): Landmark[] {
  const pose = blankPose();
  pose[LANDMARK_INDEX.left_shoulder] = {
    x: 0.4,
    y: 0.35,
    z: 0,
    visibility: 1,
  };
  pose[LANDMARK_INDEX.right_shoulder] = {
    x: 0.6,
    y: 0.35,
    z: 0,
    visibility: 1,
  };
  pose[LANDMARK_INDEX.left_hip] = { x: 0.42, y: 0.55, z: 0, visibility: 1 };
  pose[LANDMARK_INDEX.right_hip] = { x: 0.58, y: 0.55, z: 0, visibility: 1 };
  pose[LANDMARK_INDEX.right_wrist] = {
    x: wristX,
    y: wristY,
    z: 0,
    visibility: 1,
  };
  return pose;
}

/** 앞 대기 → 스윙 → 뒤 대기 */
function buildBufferedSwing(): LandmarkFrame[] {
  const frames: LandmarkFrame[] = [];
  const fps = 30;
  // 0~1.0s idle (should trim head)
  for (let i = 0; i < 30; i += 1) {
    frames.push({
      timestampMs: Math.round(i * (1000 / fps)),
      landmarks: withCoreAndWrist(0.72),
    });
  }
  // 1.0~3.0s swing
  for (let i = 0; i < 60; i += 1) {
    const t = i / 59;
    let y: number;
    let x = 0.55;
    if (t < 0.35) {
      const u = t / 0.35;
      y = 0.72 - u * 0.45;
      x = 0.55 + u * 0.05;
    } else if (t < 0.55) {
      const u = (t - 0.35) / 0.2;
      y = 0.27 + u * 0.5;
      x = 0.6 - u * 0.25;
    } else {
      const u = (t - 0.55) / 0.45;
      y = 0.77 + u * 0.02;
      x = 0.35 + u * 0.02;
    }
    frames.push({
      timestampMs: Math.round((30 + i) * (1000 / fps)),
      landmarks: withCoreAndWrist(y, x),
    });
  }
  // 3.0~4.0s idle after (should trim tail)
  for (let i = 0; i < 30; i += 1) {
    frames.push({
      timestampMs: Math.round((90 + i) * (1000 / fps)),
      landmarks: withCoreAndWrist(0.78, 0.37),
    });
  }
  return frames;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const frames = buildBufferedSwing();
  const result = trimSwingWindow(frames, { log: false });

  assert(!result.fallback, `expected trim success, got ${result.warning}`);
  assert(
    result.afterFrameCount < result.beforeFrameCount,
    'should drop some frames',
  );
  assert(result.trimmedHeadMs >= 400, `head trim too small: ${result.trimmedHeadMs}`);
  assert(result.trimmedTailMs >= 200, `tail trim too small: ${result.trimmedTailMs}`);
  assert(result.frames[0].timestampMs > 0, 'keeps original timestamps (not rebased to 0)');

  // Gate 2 cue at ~900ms — 윈도우가 그 근처부터 시작해야 함
  const cueMs = 900;
  const cued = trimSwingWindow(frames, {
    log: false,
    addressReadyMs: cueMs,
  });
  assert(!cued.fallback, `cue trim failed: ${cued.warning}`);
  assert(
    cued.frames[0].timestampMs >= cueMs - 40,
    `cue start too early: ${cued.frames[0].timestampMs}`,
  );
  assert(
    cued.frames[0].timestampMs <= cueMs + 80,
    `cue start too late: ${cued.frames[0].timestampMs}`,
  );
  assert(
    cued.trimmedHeadMs >= 800,
    `cue should trim record→ready head: ${cued.trimmedHeadMs}`,
  );

  console.log('[trimSwingWindow.sampleCheck] ok', {
    before: result.beforeFrameCount,
    after: result.afterFrameCount,
    headMs: result.trimmedHeadMs,
    tailMs: result.trimmedTailMs,
    cueStartMs: cued.frames[0].timestampMs,
    cueHeadMs: cued.trimmedHeadMs,
  });
}

main();
