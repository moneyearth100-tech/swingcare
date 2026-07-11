/** MediaPipe onLandmark 콜백 → 정규화·스무딩·상태 관리 */

import { useCallback, useRef, useState, type MutableRefObject } from 'react';

import {
  pushLandmarkHistory,
  SMOOTHING_WINDOW_SIZE,
  smoothLandmarks,
} from '../lib/landmarkSmoothing';
import {
  averageVisibility,
  normalizeLandmarkEvent,
} from '../lib/normalizeLandmarkEvent';
import type { PoseLandmarks } from '../lib/landmarkTypes';

/** 콘솔 로그 스로틀 (프레임 단위) — 실기기에서 콜백 형태 확인용 */
const LOG_EVERY_N_FRAMES = 15;

export interface UsePoseLandmarksOptions {
  /** 실기기 디버그용. 기본 true (Step 2 검증). 이후 단계에서 끌 수 있음 */
  enableLogging?: boolean;
  smoothingWindowSize?: number;
  /**
   * 녹화 버퍼용 원본 프레임 콜백 ref.
   * ref로 받아 onLandmark 재생성·무거운 클로저를 피한다 (5.2절).
   */
  onRawFrameRef?: MutableRefObject<((landmarks: PoseLandmarks) => void) | null>;
}

export interface UsePoseLandmarksResult {
  /** 화면 표시용 스무딩 랜드마크 */
  landmarks: PoseLandmarks | null;
  /** 저장/분석용 원본 랜드마크 */
  rawLandmarks: PoseLandmarks | null;
  averageVisibility: number;
  isPoseDetected: boolean;
  frameCount: number;
  lastUpdatedAtMs: number | null;
  /** RNMediapipe onLandmark에 그대로 전달 */
  onLandmark: (event: unknown) => void;
}

/**
 * 콜백에서는 정규화·상태 업데이트·(녹화 중이면) ref 버퍼 push만 수행한다.
 * 구간 분할·세션 저장 등 무거운 작업은 넣지 말 것 (5.2절).
 *
 * 실기기에서만 카메라/포즈가 동작한다. 시뮬레이터에서는 콜백이 오지 않는다.
 */
export function usePoseLandmarks(
  options: UsePoseLandmarksOptions = {},
): UsePoseLandmarksResult {
  const {
    enableLogging = true,
    smoothingWindowSize = SMOOTHING_WINDOW_SIZE,
    onRawFrameRef,
  } = options;

  const [rawLandmarks, setRawLandmarks] = useState<PoseLandmarks | null>(null);
  const [landmarks, setLandmarks] = useState<PoseLandmarks | null>(null);
  const [avgVisibility, setAvgVisibility] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [lastUpdatedAtMs, setLastUpdatedAtMs] = useState<number | null>(null);

  const historyRef = useRef<PoseLandmarks[]>([]);
  const frameCountRef = useRef(0);
  const onRawFrameRefStable = useRef(onRawFrameRef);
  onRawFrameRefStable.current = onRawFrameRef;

  const onLandmark = useCallback(
    (event: unknown) => {
      const normalized = normalizeLandmarkEvent(event);
      if (!normalized) {
        // 포즈 미검출(landmarks:[])은 정상 — 파싱 실패만 드물게 로그
        if (enableLogging && typeof event === 'string') {
          try {
            const parsed: unknown = JSON.parse(event);
            if (
              parsed &&
              typeof parsed === 'object' &&
              Array.isArray((parsed as { landmarks?: unknown }).landmarks) &&
              (parsed as { landmarks: unknown[] }).landmarks.length === 0
            ) {
              return;
            }
          } catch {
            // fall through to log
          }
        }
        if (enableLogging && frameCountRef.current % LOG_EVERY_N_FRAMES === 0) {
          console.log('[usePoseLandmarks] unparsed landmark event', {
            typeofEvent: typeof event,
            preview:
              typeof event === 'string' ? event.slice(0, 120) : event,
          });
        }
        return;
      }

      frameCountRef.current += 1;
      const nextCount = frameCountRef.current;
      const visibility = averageVisibility(normalized);

      historyRef.current = pushLandmarkHistory(
        historyRef.current,
        normalized,
        smoothingWindowSize,
      );
      const smoothed = smoothLandmarks(historyRef.current);

      // 원본 → 녹화 버퍼(ref push만). 스무딩본은 화면 표시 state에만 사용.
      onRawFrameRefStable.current?.current?.(normalized);

      setRawLandmarks(normalized);
      setLandmarks(smoothed);
      setAvgVisibility(visibility);
      setFrameCount(nextCount);
      setLastUpdatedAtMs(Date.now());

      if (enableLogging && nextCount % LOG_EVERY_N_FRAMES === 0) {
        const leftWrist = normalized[15];
        const rightWrist = normalized[16];
        console.log('[usePoseLandmarks]', {
          frame: nextCount,
          count: normalized.length,
          averageVisibility: Number(visibility.toFixed(3)),
          leftWrist: leftWrist
            ? {
                x: Number(leftWrist.x.toFixed(3)),
                y: Number(leftWrist.y.toFixed(3)),
                v: Number(leftWrist.visibility.toFixed(3)),
              }
            : null,
          rightWrist: rightWrist
            ? {
                x: Number(rightWrist.x.toFixed(3)),
                y: Number(rightWrist.y.toFixed(3)),
                v: Number(rightWrist.visibility.toFixed(3)),
              }
            : null,
        });
      }
    },
    [enableLogging, smoothingWindowSize],
  );

  return {
    landmarks,
    rawLandmarks,
    averageVisibility: avgVisibility,
    isPoseDetected: rawLandmarks != null,
    frameCount,
    lastUpdatedAtMs,
    onLandmark,
  };
}
