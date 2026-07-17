/**
 * finishAutoStop 스모크 체크.
 * 실행: npx --yes tsx src/features/swing-capture/lib/finishAutoStop.sampleCheck.ts
 */

import type { Landmark } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT, LANDMARK_INDEX } from './landmarkTypes';
import {
  createFinishAutoStopDetector,
  FINISH_AUTO_MIN_SWING_MS,
} from './finishAutoStop';

function blankPose(): Landmark[] {
  return Array.from({ length: BLAZEPOSE_LANDMARK_COUNT }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 1,
  }));
}

function poseWithWrist(x: number, y: number): Landmark[] {
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
  pose[LANDMARK_INDEX.right_wrist] = { x, y, z: 0, visibility: 1 };
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

  // 1) address wait: quiet pose must NOT finish
  {
    const d = createFinishAutoStopDetector({ dominantHand: 'right' });
    d.arm();
    let finish = false;
    for (let i = 0; i < 60; i++) {
      if (d.push(poseWithWrist(0.55, 0.62), i * dt) === 'finish') {
        finish = true;
        break;
      }
    }
    assert(!finish, 'quiet address wait must not finish');
    assert(d.getPhase() === 'waiting', 'should stay waiting');
  }

  // 2) notify ready → watching; still no finish without swing
  {
    const d = createFinishAutoStopDetector({ dominantHand: 'right' });
    d.arm();
    d.notifyAddressReadyOrSwing('test_ready');
    assert(d.getPhase() === 'watching', 'notify should watch');
    let finish = false;
    for (let i = 0; i < 45; i++) {
      if (d.push(poseWithWrist(0.55, 0.62), i * dt) === 'finish') {
        finish = true;
        break;
      }
    }
    assert(!finish, 'watching still pose must not finish');
  }

  // 3) takeaway during wait → swing → peak → settle → finish
  {
    const d = createFinishAutoStopDetector({
      dominantHand: 'right',
      minSwingMs: FINISH_AUTO_MIN_SWING_MS,
    });
    d.arm();
    d.notifyAddressReadyOrSwing('test_ready');

    let t = 0;
    let sawSwing = false;
    let sawFinish = false;

    // address still
    for (let i = 0; i < 10; i++) {
      d.push(poseWithWrist(0.55, 0.72), t);
      t += dt;
    }

    // takeaway burst (large Δx per frame → high vel)
    let x = 0.55;
    for (let i = 0; i < 4; i++) {
      x += 0.08;
      const r = d.push(poseWithWrist(x, 0.7), t);
      t += dt;
      if (r === 'swing') {
        sawSwing = true;
      }
    }
    assert(sawSwing, 'expected swing from takeaway');
    assert(d.getPhase() === 'swing', 'phase swing');

    // backswing up (y decreases)
    let y = 0.7;
    for (let i = 0; i < 12; i++) {
      y -= 0.035;
      x += 0.01;
      d.push(poseWithWrist(x, y), t);
      t += dt;
    }

    // downswing / impact (y increases fast)
    for (let i = 0; i < 10; i++) {
      y += 0.055;
      x -= 0.025;
      d.push(poseWithWrist(x, y), t);
      t += dt;
    }

    // settle at finish
    for (let i = 0; i < 30; i++) {
      const r = d.push(poseWithWrist(x, y), t);
      t += dt;
      if (r === 'finish') {
        sawFinish = true;
        break;
      }
    }
    assert(sawFinish, 'expected finish after settle');
    assert(d.getPhase() === 'finish', 'phase finish');
  }

  // 4) takeaway without Gate 2 notify still arms swing (timeout path companion)
  {
    const d = createFinishAutoStopDetector({ dominantHand: 'right' });
    d.arm();
    let t = 0;
    d.push(poseWithWrist(0.55, 0.7), t);
    t += dt;
    d.push(poseWithWrist(0.63, 0.7), t);
    t += dt;
    const r = d.push(poseWithWrist(0.71, 0.7), t);
    assert(r === 'swing', 'takeaway without notify should still swing');
  }

  // 5) Gate 2 skipped → notify promotes to swing without second takeaway
  {
    const d = createFinishAutoStopDetector({ dominantHand: 'right' });
    d.arm();
    d.push(poseWithWrist(0.55, 0.7), 0);
    d.notifyAddressReadyOrSwing('skipped_swing_started');
    assert(d.getPhase() === 'swing', 'skip notify should enter swing');
  }

  console.log('[finishAutoStop.sampleCheck] ok');
}

run();
