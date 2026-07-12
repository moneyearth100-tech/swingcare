/** 녹화 시작/종료 및 원본 랜드마크 프레임 버퍼링 */

import { useCallback, useRef, useState, type MutableRefObject } from 'react';

import type { LandmarkFrame, PoseLandmarks } from '../lib/landmarkTypes';

/** UI 프레임 카운트 갱신 간격 — onLandmark 경로의 setState 부하 완화 */
const BUFFER_COUNT_UI_INTERVAL = 5;

export interface SwingRecordingResult {
  /** 저장/분석용 원본 프레임 (스무딩 미적용) */
  frames: LandmarkFrame[];
  durationMs: number;
  startedAtMs: number;
  endedAtMs: number;
}

export interface UseSwingRecorderResult {
  isRecording: boolean;
  /** 현재 버퍼에 쌓인 원본 프레임 수 */
  bufferedFrameCount: number;
  /** 직전 stopRecording 결과 (세션 저장은 Step 6) */
  lastResult: SwingRecordingResult | null;
  startRecording: () => void;
  stopRecording: () => SwingRecordingResult | null;
  /**
   * 녹화 중일 때만 원본 프레임을 ref 버퍼에 push.
   * onLandmark에서 직접 무거운 연산 없이 이 함수만 호출할 것.
   */
  appendRawFrame: (landmarks: PoseLandmarks) => void;
  /** usePoseLandmarks에 안정적으로 넘기기 위한 ref */
  appendRawFrameRef: MutableRefObject<
    ((landmarks: PoseLandmarks) => void) | null
  >;
}

/**
 * 이 훅은 원본 좌표 버퍼만 담당한다.
 * 카메라 픽셀 녹화는 MediaPipe 네이티브 세션에서 동시에 처리한다.
 */
export function useSwingRecorder(): UseSwingRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [bufferedFrameCount, setBufferedFrameCount] = useState(0);
  const [lastResult, setLastResult] = useState<SwingRecordingResult | null>(
    null,
  );

  const isRecordingRef = useRef(false);
  const startedAtMsRef = useRef<number | null>(null);
  const bufferRef = useRef<LandmarkFrame[]>([]);

  const appendRawFrame = useCallback((landmarks: PoseLandmarks) => {
    if (!isRecordingRef.current || startedAtMsRef.current == null) {
      return;
    }

    const timestampMs = Date.now() - startedAtMsRef.current;
    bufferRef.current.push({
      timestampMs,
      landmarks,
    });

    const count = bufferRef.current.length;
    if (count === 1 || count % BUFFER_COUNT_UI_INTERVAL === 0) {
      setBufferedFrameCount(count);
    }
  }, []);

  const appendRawFrameRef = useRef<
    ((landmarks: PoseLandmarks) => void) | null
  >(appendRawFrame);
  appendRawFrameRef.current = appendRawFrame;

  const startRecording = useCallback(() => {
    bufferRef.current = [];
    startedAtMsRef.current = Date.now();
    isRecordingRef.current = true;
    setBufferedFrameCount(0);
    setLastResult(null);
    setIsRecording(true);
    console.log('[useSwingRecorder] start');
  }, []);

  const stopRecording = useCallback((): SwingRecordingResult | null => {
    if (!isRecordingRef.current || startedAtMsRef.current == null) {
      return null;
    }

    const endedAtMs = Date.now();
    const startedAtMs = startedAtMsRef.current;
    const frames = bufferRef.current.slice();

    isRecordingRef.current = false;
    startedAtMsRef.current = null;
    bufferRef.current = [];

    const result: SwingRecordingResult = {
      frames,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      startedAtMs,
      endedAtMs,
    };

    setIsRecording(false);
    setBufferedFrameCount(frames.length);
    setLastResult(result);

    console.log('[useSwingRecorder] stop', {
      frameCount: frames.length,
      durationMs: result.durationMs,
      firstTimestampMs: frames[0]?.timestampMs ?? null,
      lastTimestampMs: frames[frames.length - 1]?.timestampMs ?? null,
    });

    return result;
  }, []);

  return {
    isRecording,
    bufferedFrameCount,
    lastResult,
    startRecording,
    stopRecording,
    appendRawFrame,
    appendRawFrameRef,
  };
}
