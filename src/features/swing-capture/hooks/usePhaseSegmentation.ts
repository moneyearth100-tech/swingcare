/**
 * LandmarkFrame[] → PhaseMarker[] 구간 분할 훅.
 * 내부는 phaseSegmentation.ts 순수 함수 — 학습 모델로 교체 시 이 래퍼만 유지.
 */

import { useCallback, useRef, useState } from 'react';

import type { LandmarkFrame, PhaseMarker } from '../lib/landmarkTypes';
import {
  segmentSwingPhases,
  type SegmentSwingPhasesOptions,
  type SegmentSwingPhasesResult,
} from '../lib/phaseSegmentation';

export interface UsePhaseSegmentationResult {
  phases: PhaseMarker[];
  lastResult: SegmentSwingPhasesResult | null;
  warning: string | null;
  /** 녹화 종료 후 원본 프레임으로 구간 분할 실행 */
  segment: (
    frames: LandmarkFrame[],
    options?: SegmentSwingPhasesOptions,
  ) => SegmentSwingPhasesResult;
  clear: () => void;
}

/**
 * 세그멘테이션은 녹화 종료 후 일괄 실행 (onLandmark 경로에 넣지 말 것).
 */
export function usePhaseSegmentation(
  defaultOptions: SegmentSwingPhasesOptions = {},
): UsePhaseSegmentationResult {
  const [lastResult, setLastResult] = useState<SegmentSwingPhasesResult | null>(
    null,
  );
  const defaultOptionsRef = useRef(defaultOptions);
  defaultOptionsRef.current = defaultOptions;

  const segment = useCallback(
    (
      frames: LandmarkFrame[],
      options?: SegmentSwingPhasesOptions,
    ): SegmentSwingPhasesResult => {
      const result = segmentSwingPhases(frames, {
        ...defaultOptionsRef.current,
        ...options,
      });
      setLastResult(result);
      return result;
    },
    [],
  );

  const clear = useCallback(() => {
    setLastResult(null);
  }, []);

  return {
    phases: lastResult?.phases ?? [],
    lastResult,
    warning: lastResult?.warning ?? null,
    segment,
    clear,
  };
}
