import { extractPoseFromVideo } from '@thinksys/react-native-mediapipe';
import { Platform } from 'react-native';

import { segmentSwingPhases } from './phaseSegmentation';
import type { LandmarkFrame, PhaseMarker } from './landmarkTypes';
import {
  computeBalanceScore,
  type BalanceScoreResult,
} from './scoring/balanceScore';
import { matchDiagnosis } from './scoring/diagnosisTemplates';

// Android MediaMetadataRetriever의 임의 프레임 탐색은 고해상도 영상에서 매우
// 느리므로 자세 점수에 충분한 5fps로 제한한다. iOS는 AVAsset 기반 15fps를 유지한다.
const DEFAULT_EXTRACT_FPS = Platform.OS === 'android' ? 5 : 15;
const LANDMARK_COUNT = 33;
const VIDEO_ANALYSIS_TIMEOUT_MS = 90_000;

export interface OnDeviceAnalysisProgress {
  percent: number;
  status: string;
}

async function extractWithTimeout(
  options: Parameters<typeof extractPoseFromVideo>[0],
  onProgress?: Parameters<typeof extractPoseFromVideo>[1],
): Promise<Awaited<ReturnType<typeof extractPoseFromVideo>>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  try {
    return await Promise.race([
      extractPoseFromVideo(options, (progress) => {
        if (active) {
          onProgress?.(progress);
        }
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              '영상 분석 시간이 초과됐어요. 앱을 다시 시도하거나 다른 영상을 선택해 주세요.',
            ),
          );
        }, VIDEO_ANALYSIS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    active = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export interface OnDeviceVideoAnalysis {
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
  fps: number;
  durationMs: number;
  detectedFrameCount: number;
  balanceScore: BalanceScoreResult;
  issuePhase: string | null;
  diagnosisText: string;
  recommendedDrillId: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateFrames(value: unknown): LandmarkFrame[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('분석할 자세 프레임이 생성되지 않았어요.');
  }
  for (const frame of value) {
    if (
      !frame ||
      typeof frame !== 'object' ||
      !isFiniteNumber((frame as LandmarkFrame).timestampMs) ||
      !Array.isArray((frame as LandmarkFrame).landmarks) ||
      (frame as LandmarkFrame).landmarks.length !== LANDMARK_COUNT
    ) {
      throw new Error('자세 분석 결과 형식이 올바르지 않아요.');
    }
  }
  return value as LandmarkFrame[];
}

export async function analyzeVideoOnDevice(input: {
  uri: string;
  expectedDurationMs: number;
  fps?: number;
  onProgress?: (progress: OnDeviceAnalysisProgress) => void;
}): Promise<OnDeviceVideoAnalysis> {
  let extracted: Awaited<ReturnType<typeof extractPoseFromVideo>>;
  let lastReportedPercent = -1;
  const report = (percent: number, status: string) => {
    if (!Number.isFinite(percent)) {
      return;
    }
    const safePercent = Math.round(Math.max(0, Math.min(100, percent)));
    if (safePercent === lastReportedPercent) {
      return;
    }
    lastReportedPercent = safePercent;
    input.onProgress?.({ percent: safePercent, status });
  };

  // Native progress may be missing on older builds; keep UI alive safely.
  const stagedTimers = [
    { delayMs: 1200, percent: 12, status: '영상 분석 중' },
    { delayMs: 3500, percent: 35, status: '영상 분석 중' },
    { delayMs: 7000, percent: 55, status: '영상 분석 중' },
    { delayMs: 12000, percent: 72, status: '영상 분석 중' },
  ].map(({ delayMs, percent, status }) =>
    setTimeout(() => {
      if (lastReportedPercent < percent) {
        report(percent, status);
      }
    }, delayMs),
  );

  try {
    report(3, '프레임 추출 준비 중');
    extracted = await extractWithTimeout({
      uri: input.uri,
      fps: input.fps ?? DEFAULT_EXTRACT_FPS,
    }, (nativeProgress) => {
      const rawRatio = (nativeProgress as { progress?: unknown } | null)
        ?.progress;
      if (!isFiniteNumber(rawRatio)) {
        return;
      }
      const ratio = Math.max(0, Math.min(1, rawRatio));
      report(5 + ratio * 80, '영상 분석 중');
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('unavailable') ||
      message.includes('extractPoseFromVideo') ||
      message.includes('undefined is not a function')
    ) {
      throw new Error(
        '온디바이스 영상 분석 모듈이 없습니다. Dev Client를 다시 빌드해 주세요.',
      );
    }
    throw new Error(
      message.includes('포즈를 찾지 못')
        ? message
        : `기기 내 자세 분석에 실패했어요. ${message}`,
    );
  } finally {
    for (const timer of stagedTimers) {
      clearTimeout(timer);
    }
  }

  report(88, '스윙 구간 찾는 중');
  const frames = validateFrames(extracted.frames);
  const phases = segmentSwingPhases(frames).phases;
  report(93, '점수 계산 중');
  const balanceScore = computeBalanceScore(frames, phases);
  const diagnosis = matchDiagnosis(balanceScore, phases);

  return {
    frames,
    phases,
    fps: isFiniteNumber(extracted.fps) ? extracted.fps : DEFAULT_EXTRACT_FPS,
    durationMs: isFiniteNumber(extracted.durationMs)
      ? extracted.durationMs
      : input.expectedDurationMs,
    detectedFrameCount: isFiniteNumber(extracted.detectedFrameCount)
      ? extracted.detectedFrameCount
      : frames.length,
    balanceScore,
    issuePhase: diagnosis.issuePhase,
    diagnosisText: diagnosis.diagnosisText,
    recommendedDrillId: diagnosis.template.recommendedDrillId,
  };
}
