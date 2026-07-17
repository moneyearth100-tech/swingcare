/**
 * addressReadyCue 스모크 체크.
 * 실행: npx --yes tsx src/features/swing-capture/lib/addressReadyCue.sampleCheck.ts
 */

import type { Landmark } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT, LANDMARK_INDEX } from './landmarkTypes';
import {
  ADDRESS_READY_MIN_WAIT_MS,
  ADDRESS_READY_STABLE_MS,
  createAddressReadyDetector,
} from './addressReadyCue';

function blankPose(): Landmark[] {
  return Array.from({ length: BLAZEPOSE_LANDMARK_COUNT }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 1,
  }));
}

function addressPose(wristJitter = 0): Landmark[] {
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
    x: 0.55 + wristJitter,
    y: 0.62,
    z: 0,
    visibility: 1,
  };
  return pose;
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(msg);
  }
}

function run() {
  const fps = 30;
  const dt = 1000 / fps;

  // 1) mild jitter should still fire (live noise)
  {
    const d = createAddressReadyDetector({ dominantHand: 'right' });
    let fired = false;
    let fireReason: string | null = null;
    // minWait(400) + stable(1700) ≈ 2.1s → need >~70 frames @ 30fps
    for (let i = 0; i < 120; i++) {
      const jitter = (i % 2 === 0 ? 1 : -1) * 0.003;
      const r = d.push(addressPose(jitter), i * dt);
      if (r === 'fire') {
        fired = true;
        fireReason = d.getLastFireReason();
        break;
      }
    }
    assert(fired, 'expected fire with mild wrist jitter 0.003');
    assert(d.getPhase() === 'ready', 'phase should be ready');
    assert(fireReason === 'stable_hold', 'fire reason must be stable_hold');
  }

  // 2) clear takeaway should skip (needs 2 consecutive high-vel frames)
  {
    const d = createAddressReadyDetector({ dominantHand: 'right' });
    d.push(addressPose(0), 500);
    d.push(addressPose(0.08), 500 + dt);
    const skip = d.push(addressPose(0.16), 500 + 2 * dt);
    assert(skip == null, 'takeaway frame should not fire');
    assert(
      d.getPhase() === 'skipped_swing_started',
      'expected skipped_swing_started',
    );
  }

  // 3) needs ~stableMs of continuous hold (minWait + stable)
  {
    const d = createAddressReadyDetector({
      dominantHand: 'right',
      stableMs: ADDRESS_READY_STABLE_MS,
    });
    let fireAt: number | null = null;
    for (let i = 0; i < 120; i++) {
      const t = i * dt;
      if (d.push(addressPose(0), t) === 'fire') {
        fireAt = t;
        break;
      }
    }
    assert(fireAt != null, 'expected fire on still pose');
    const minExpected = ADDRESS_READY_MIN_WAIT_MS + ADDRESS_READY_STABLE_MS;
    // stable timer starts after minWait; fire at earliest ~ minWait + stableMs
    // (first post-minWait frame starts the timer, so fire ≈ minWait + stable)
    assert(
      fireAt! >= ADDRESS_READY_STABLE_MS,
      `fire too early vs stableMs: ${fireAt} < ${ADDRESS_READY_STABLE_MS}`,
    );
    assert(
      fireAt! + dt >= minExpected - ADDRESS_READY_MIN_WAIT_MS,
      `fire unexpectedly early: ${fireAt}`,
    );
    assert(
      d.getLastFireReason() === 'stable_hold',
      'only stable_hold is allowed',
    );
  }

  // 4) fidget / high motion for >2s must NOT fire (no fallback timer)
  {
    const d = createAddressReadyDetector({ dominantHand: 'right' });
    let fired = false;
    for (let i = 0; i < 90; i++) {
      // ±0.02 @ 30fps → vel ~0.08: above stable EMA (0.045), below takeaway (0.12)
      const jitter = (i % 2 === 0 ? 1 : -1) * 0.02;
      if (d.push(addressPose(jitter), i * dt) === 'fire') {
        fired = true;
        break;
      }
    }
    assert(!fired, 'fidget pose for ~3s must not fire (no fallback)');
    assert(
      d.getPhase() !== 'ready',
      'phase must not be ready without stable hold',
    );
  }

  // 4b) iPhone-like mild MediaPipe jitter (±0.01) SHOULD fire with EMA
  {
    const d = createAddressReadyDetector({ dominantHand: 'right' });
    let fired = false;
    for (let i = 0; i < 120; i++) {
      const jitter = (i % 2 === 0 ? 1 : -1) * 0.01;
      if (d.push(addressPose(jitter), i * dt) === 'fire') {
        fired = true;
        break;
      }
    }
    assert(fired, 'mild ±0.01 wrist jitter should still fire (EMA)');
  }

  // 5) swing before stable → skip, no voice path
  {
    const d = createAddressReadyDetector({ dominantHand: 'right' });
    // brief still (not enough for stable)
    for (let i = 0; i < 15; i++) {
      d.push(addressPose(0), i * dt);
    }
    assert(d.getPhase() !== 'ready', 'must not be ready before full hold');
    d.push(addressPose(0.1), 15 * dt);
    d.push(addressPose(0.2), 16 * dt);
    assert(
      d.getPhase() === 'skipped_swing_started',
      'takeaway before stable should skip',
    );
    assert(d.getLastFireReason() == null, 'skip must not set fire reason');
  }

  console.log('[addressReadyCue.sampleCheck] ok');
}

run();
