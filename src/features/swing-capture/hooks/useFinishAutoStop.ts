/**
 * 게이트 3 — 피니시 감지 후 pad → 자동 stop, 또는 15s 타임아웃.
 * stopRecording / 저장 파이프라인은 호출측 onRequestStop 이 담당.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AddressReadyPhase } from '../lib/addressReadyCue';
import {
  createFinishAutoStopDetector,
  FINISH_AUTO_STOP_PAD_MS,
  RECORD_TIMEOUT_MS,
  type FinishAutoStopDetector,
  type FinishAutoStopPhase,
} from '../lib/finishAutoStop';
import type { DominantHand } from '../lib/scoring/movementMetrics';
import { trailWristIndexForDominantHand } from '../lib/scoring/movementMetrics';
import type { PoseLandmarks } from '../lib/landmarkTypes';

/** UI / 훅이 노출하는 진행 상태 (detector + pad/timeout) */
export type FinishAutoStopUiPhase =
  | 'idle'
  | 'waiting'
  | 'watching'
  | 'swing'
  | 'finish_pad'
  | 'stopping'
  | 'timeout';

export type FinishAutoStopReason = 'finish' | 'timeout';

export interface UseFinishAutoStopResult {
  phase: FinishAutoStopUiPhase;
  onRecordingFrame: (
    landmarks: PoseLandmarks,
    timestampMs: number,
  ) => void;
  /** 수동 stop / abort 시 pad·timeout 취소 */
  cancelPendingStop: () => void;
}

function toUiPhase(detectorPhase: FinishAutoStopPhase): FinishAutoStopUiPhase {
  switch (detectorPhase) {
    case 'idle':
      return 'idle';
    case 'waiting':
      return 'waiting';
    case 'watching':
      return 'watching';
    case 'swing':
      return 'swing';
    case 'finish':
      return 'finish_pad';
    default:
      return 'idle';
  }
}

export function useFinishAutoStop(options: {
  dominantHand: DominantHand | null;
  isRecording: boolean;
  addressReadyPhase: AddressReadyPhase;
  onRequestStop: (reason: FinishAutoStopReason) => void;
}): UseFinishAutoStopResult {
  const { dominantHand, isRecording, addressReadyPhase, onRequestStop } =
    options;

  const [phase, setPhase] = useState<FinishAutoStopUiPhase>('idle');

  const detectorRef = useRef<FinishAutoStopDetector | null>(null);
  const dominantHandRef = useRef(dominantHand);
  const armedTrailWristRef = useRef(
    trailWristIndexForDominantHand(dominantHand),
  );
  const isRecordingRef = useRef(isRecording);
  const addressReadyPhaseRef = useRef(addressReadyPhase);
  const onRequestStopRef = useRef(onRequestStop);
  /** 세션 세대 — 이전 pad/timeout 무시 */
  const generationRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const padTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Gate 2 ready/skipped 를 이미 notify 했는지 */
  const notifiedReadyRef = useRef(false);

  dominantHandRef.current = dominantHand;
  isRecordingRef.current = isRecording;
  addressReadyPhaseRef.current = addressReadyPhase;
  onRequestStopRef.current = onRequestStop;

  const clearTimers = useCallback(() => {
    if (padTimerRef.current != null) {
      clearTimeout(padTimerRef.current);
      padTimerRef.current = null;
    }
    if (timeoutTimerRef.current != null) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const cancelPendingStop = useCallback(() => {
    generationRef.current += 1;
    stopRequestedRef.current = true;
    clearTimers();
    console.log('[finishAutoStop] cancelPendingStop');
  }, [clearTimers]);

  const requestStop = useCallback(
    (reason: FinishAutoStopReason, generation: number) => {
      if (generation !== generationRef.current) {
        console.log('[finishAutoStop] stop skipped — stale generation', {
          reason,
          generation,
          current: generationRef.current,
        });
        return;
      }
      if (stopRequestedRef.current) {
        console.log('[finishAutoStop] stop skipped — already requested', {
          reason,
        });
        return;
      }
      if (!isRecordingRef.current) {
        console.log('[finishAutoStop] stop skipped — not recording', {
          reason,
        });
        return;
      }
      stopRequestedRef.current = true;
      clearTimers();
      setPhase(reason === 'timeout' ? 'timeout' : 'stopping');
      console.log('[finishAutoStop] auto-stop', {
        reason,
        generation,
        padMs: FINISH_AUTO_STOP_PAD_MS,
        timeoutMs: RECORD_TIMEOUT_MS,
      });
      onRequestStopRef.current(reason);
    },
    [clearTimers],
  );

  const scheduleFinishPad = useCallback(
    (generation: number) => {
      if (padTimerRef.current != null) {
        return;
      }
      setPhase('finish_pad');
      console.log('[finishAutoStop] finish pad started', {
        padMs: FINISH_AUTO_STOP_PAD_MS,
        generation,
      });
      padTimerRef.current = setTimeout(() => {
        padTimerRef.current = null;
        requestStop('finish', generation);
      }, FINISH_AUTO_STOP_PAD_MS);
    },
    [requestStop],
  );

  const armForRecording = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    stopRequestedRef.current = false;
    notifiedReadyRef.current = false;
    clearTimers();

    const hand = dominantHandRef.current;
    armedTrailWristRef.current = trailWristIndexForDominantHand(hand);
    const detector = createFinishAutoStopDetector({ dominantHand: hand });
    detector.arm();
    detectorRef.current = detector;
    setPhase('waiting');

    timeoutTimerRef.current = setTimeout(() => {
      timeoutTimerRef.current = null;
      console.log('[finishAutoStop] timeout', {
        timeoutMs: RECORD_TIMEOUT_MS,
        generation,
      });
      requestStop('timeout', generation);
    }, RECORD_TIMEOUT_MS);

    // 이미 ready/skipped 면 즉시 watch/swing arm (race: Gate 2 fire 후 이 effect)
    const addr = addressReadyPhaseRef.current;
    if (addr === 'ready' || addr === 'skipped_swing_started') {
      notifiedReadyRef.current = true;
      detector.notifyAddressReadyOrSwing(addr);
      setPhase(addr === 'skipped_swing_started' ? 'swing' : 'watching');
    }

    console.log('[finishAutoStop] session armed', {
      generation,
      dominantHand: hand,
      timeoutMs: RECORD_TIMEOUT_MS,
      padMs: FINISH_AUTO_STOP_PAD_MS,
      addressReadyPhase: addr,
    });
  }, [clearTimers, requestStop]);

  const disarm = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    detectorRef.current = null;
    notifiedReadyRef.current = false;
    stopRequestedRef.current = false;
    setPhase('idle');
    console.log('[finishAutoStop] disarmed');
  }, [clearTimers]);

  const armForRecordingRef = useRef(armForRecording);
  armForRecordingRef.current = armForRecording;
  const disarmRef = useRef(disarm);
  disarmRef.current = disarm;

  useEffect(() => {
    if (isRecording) {
      armForRecordingRef.current();
      return;
    }
    disarmRef.current();
  }, [isRecording]);

  // Gate 2 phase → finish watch arm (어드레스 대기 중 finish 금지)
  useEffect(() => {
    if (!isRecordingRef.current || !detectorRef.current) {
      return;
    }
    if (notifiedReadyRef.current) {
      return;
    }
    if (
      addressReadyPhase !== 'ready' &&
      addressReadyPhase !== 'skipped_swing_started'
    ) {
      return;
    }
    notifiedReadyRef.current = true;
    detectorRef.current.notifyAddressReadyOrSwing(addressReadyPhase);
    setPhase((prev) => {
      if (
        prev === 'finish_pad' ||
        prev === 'stopping' ||
        prev === 'timeout' ||
        prev === 'swing'
      ) {
        return prev;
      }
      return addressReadyPhase === 'skipped_swing_started'
        ? 'swing'
        : 'watching';
    });
  }, [addressReadyPhase]);

  // 녹화 중 타수 변경 — finish 미확정이면 디텍터만 교체
  useEffect(() => {
    if (!isRecordingRef.current || !detectorRef.current) {
      return;
    }
    const current = detectorRef.current.getPhase();
    if (current === 'finish' || current === 'swing') {
      return;
    }
    const nextIndex = trailWristIndexForDominantHand(dominantHand);
    if (nextIndex === armedTrailWristRef.current) {
      return;
    }
    armedTrailWristRef.current = nextIndex;
    const detector = createFinishAutoStopDetector({ dominantHand });
    detector.arm();
    if (notifiedReadyRef.current) {
      detector.notifyAddressReadyOrSwing(
        addressReadyPhaseRef.current === 'skipped_swing_started'
          ? 'skipped_swing_started'
          : 'hand_change',
      );
    }
    detectorRef.current = detector;
    setPhase(
      addressReadyPhaseRef.current === 'skipped_swing_started'
        ? 'swing'
        : notifiedReadyRef.current
          ? 'watching'
          : 'waiting',
    );
    console.log('[finishAutoStop] detector re-armed for hand change', {
      dominantHand,
      trailWristIndex: nextIndex,
    });
  }, [dominantHand]);

  const onRecordingFrame = useCallback(
    (landmarks: PoseLandmarks, timestampMs: number) => {
      const detector = detectorRef.current;
      if (!detector || stopRequestedRef.current) {
        return;
      }

      const result = detector.push(landmarks, timestampMs);
      const next = toUiPhase(detector.getPhase());
      setPhase((prev) => {
        if (
          prev === 'finish_pad' ||
          prev === 'stopping' ||
          prev === 'timeout'
        ) {
          return prev;
        }
        return prev === next ? prev : next;
      });

      if (result === 'swing') {
        setPhase('swing');
        return;
      }

      if (result === 'finish') {
        scheduleFinishPad(generationRef.current);
      }
    },
    [scheduleFinishPad],
  );

  return {
    phase,
    onRecordingFrame,
    cancelPendingStop,
  };
}
