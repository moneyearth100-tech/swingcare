/** MediaPipe onLandmark 콜백 → 정규화·스무딩·상태 관리 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Platform } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import {
  emaAlphaFromDt,
  SMOOTHING_EMA_TAU_MS_ANDROID,
  SMOOTHING_EMA_TAU_MS_IOS,
  smoothLandmarksEma,
} from '../lib/landmarkSmoothing';
import {
  averageVisibility,
  normalizeLandmarkEvent,
} from '../lib/normalizeLandmarkEvent';
import type { PoseLandmarks } from '../lib/landmarkTypes';
import { LANDMARK_INDEX } from '../lib/landmarkTypes';
import { isPoseEffectivelyAbsent } from '../lib/posePresence';
import {
  createEmptyPackedPosePoints,
  packPosePoints,
  type PackedPosePoints,
} from '../lib/packedPosePoints';

/** 콘솔 로그 스로틀 (프레임 단위) — 실기기에서 콜백 형태 확인용 */
const LOG_EVERY_N_FRAMES = 15;

/** 상태바용 React setState 최소 간격 — SharedValue는 매 프레임 갱신 */
const UI_STATE_MIN_INTERVAL_MS = 100;

/**
 * 유효 포즈 콜백이 이 시간 이상 없으면 스켈레톤·상태를 비운다.
 * iOS는 사람 이탈 후 빈 landmarks 콜백 없이 콜백이 끊기는 경우가 많음.
 */
const POSE_STALE_CLEAR_MS = 400;
/** 스텔니스 폴링 간격 */
const POSE_STALE_POLL_MS = 100;

/** TEMP: onLandmark 진단 로그 — 좌우/스키마 검증 완료 후 비활성 */
const TEMP_LANDMARK_DIAGNOSTICS = false;

/**
 * TEMP: 원본 vs 스무딩 지연 구분용 (검증 후 false).
 * raw 손목이 빠르게 변하는데 smoothed만 늦으면 스무딩/표시 경로 지연.
 * raw 자체 간격(dtMs)이 크면 네이티브 콜백/브릿지 지연.
 */
const TEMP_LATENCY_DIAGNOSTICS = false;

/**
 * TEMP: Android onLandmark dt 분포 (평균 fps가 아닌 max/stddev/스파이크).
 * 윈도우마다 요약 로그 후 비활성(false)로 돌릴 것.
 */
const TEMP_DT_DISTRIBUTION = false;
/** dt 샘플을 모아 요약하는 윈도우 크기 */
const TEMP_DT_WINDOW_SAMPLES = 40;
/** 이 값 초과 dt를 스파이크로 카운트 (ms) */
const TEMP_DT_SPIKE_MS = 120;
const TEMP_DT_SPIKE_HARD_MS = 250;

export interface UsePoseLandmarksOptions {
  /** 실기기 디버그용. 기본 true (Step 2 검증). 이후 단계에서 끌 수 있음 */
  enableLogging?: boolean;
  /** 시간 기반 EMA τ(ms). 미지정 시 iOS 80 / Android 35 */
  smoothingTauMs?: number;
  /**
   * 녹화 버퍼용 원본 프레임 콜백 ref.
   * ref로 받아 onLandmark 재생성·무거운 클로저를 피한다 (5.2절).
   */
  onRawFrameRef?: MutableRefObject<((landmarks: PoseLandmarks) => void) | null>;
  /**
   * 화면 표시용 스무딩 좌표 SharedValue.
   * 콜백에서 value 할당만 하고, Skia 렌더는 UI/worklet 경로에서 처리.
   */
  displayPointsSV?: SharedValue<PackedPosePoints>;
  /** 카메라 뷰 크기 — Android cover 매핑에 필요 */
  viewSizeRef?: MutableRefObject<{ width: number; height: number }>;
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

function inspectLandmarkFields(landmarks: unknown[]): {
  count: number;
  hasXYZV: boolean;
  sampleKeys: string[];
} {
  if (landmarks.length === 0) {
    return { count: 0, hasXYZV: false, sampleKeys: [] };
  }
  const first = landmarks[0];
  const sampleKeys =
    first && typeof first === 'object' ? Object.keys(first as object) : [];
  const hasXYZV = landmarks.every((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const point = item as Record<string, unknown>;
    return (
      typeof point.x === 'number' &&
      typeof point.y === 'number' &&
      typeof point.z === 'number' &&
      (typeof point.visibility === 'number' || typeof point.presence === 'number')
    );
  });
  return { count: landmarks.length, hasXYZV, sampleKeys };
}

function summarizeDtSamples(samples: number[]): {
  n: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  stdMs: number;
  meanFps: number;
  spikesOver120: number;
  spikesOver250: number;
} {
  const n = samples.length;
  if (n === 0) {
    return {
      n: 0,
      meanMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
      stdMs: 0,
      meanFps: 0,
      spikesOver120: 0,
      spikesOver250: 0,
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const variance =
    samples.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / n;
  const p95Index = Math.min(n - 1, Math.floor(n * 0.95));
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    meanMs: Number(mean.toFixed(1)),
    medianMs: Number(median.toFixed(1)),
    p95Ms: Number(sorted[p95Index].toFixed(1)),
    maxMs: Number(sorted[n - 1].toFixed(1)),
    stdMs: Number(Math.sqrt(variance).toFixed(1)),
    meanFps: Number((1000 / mean).toFixed(1)),
    spikesOver120: samples.filter((v) => v >= TEMP_DT_SPIKE_MS).length,
    spikesOver250: samples.filter((v) => v >= TEMP_DT_SPIKE_HARD_MS).length,
  };
}

function summarizeMsSamples(samples: number[]): {
  n: number;
  meanMs: number;
  maxMs: number;
} {
  if (samples.length === 0) {
    return { n: 0, meanMs: 0, maxMs: 0 };
  }
  const sum = samples.reduce((acc, v) => acc + v, 0);
  return {
    n: samples.length,
    meanMs: Number((sum / samples.length).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
  };
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
    // Android 브릿지 지연 보정 — iOS τ는 유지
    smoothingTauMs = Platform.OS === 'android'
      ? SMOOTHING_EMA_TAU_MS_ANDROID
      : SMOOTHING_EMA_TAU_MS_IOS,
    onRawFrameRef,
    displayPointsSV,
    viewSizeRef,
  } = options;

  const [rawLandmarks, setRawLandmarks] = useState<PoseLandmarks | null>(null);
  const [landmarks, setLandmarks] = useState<PoseLandmarks | null>(null);
  const [avgVisibility, setAvgVisibility] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [lastUpdatedAtMs, setLastUpdatedAtMs] = useState<number | null>(null);

  const smoothedPrevRef = useRef<PoseLandmarks | null>(null);
  /** 시간 기반 EMA용 이전 콜백 시각 (performance.now) */
  const emaLastAtRef = useRef(0);
  const frameCountRef = useRef(0);
  /** 마지막 "유효 포즈" 콜백 시각 — 스로틀과 무관하게 매 프레임 갱신 */
  const lastValidPoseAtRef = useRef(0);
  const onRawFrameRefStable = useRef(onRawFrameRef);
  onRawFrameRefStable.current = onRawFrameRef;
  const displayPointsSVRef = useRef(displayPointsSV);
  displayPointsSVRef.current = displayPointsSV;
  const viewSizeRefStable = useRef(viewSizeRef);
  viewSizeRefStable.current = viewSizeRef;

  // TEMP diagnostics
  const diagWindowStartRef = useRef(Date.now());
  const diagWindowCountRef = useRef(0);
  const diagFullDumpAtRef = useRef(0);
  const latencyLogAtRef = useRef(0);
  const lastUiStateAtRef = useRef(0);
  const dtLastAtRef = useRef(0);
  const dtSamplesRef = useRef<number[]>([]);
  const parseMsSamplesRef = useRef<number[]>([]);
  const handlerMsSamplesRef = useRef<number[]>([]);
  const dtWindowIndexRef = useRef(0);

  const clearPoseUi = useCallback(() => {
    if (displayPointsSVRef.current) {
      displayPointsSVRef.current.value = createEmptyPackedPosePoints();
    }
    smoothedPrevRef.current = null;
    emaLastAtRef.current = 0;
    lastValidPoseAtRef.current = 0;
    lastUiStateAtRef.current = Date.now();
    setRawLandmarks(null);
    setLandmarks(null);
    setAvgVisibility(0);
    setLastUpdatedAtMs(null);
  }, []);

  // iOS: 사람 이탈 후 콜백 단절 → 마지막 스켈레톤이 남는 문제 방지
  useEffect(() => {
    const timer = setInterval(() => {
      const last = lastValidPoseAtRef.current;
      if (last <= 0) {
        return;
      }
      if (Date.now() - last < POSE_STALE_CLEAR_MS) {
        return;
      }
      clearPoseUi();
    }, POSE_STALE_POLL_MS);
    return () => clearInterval(timer);
  }, [clearPoseUi]);

  const onLandmark = useCallback(
    (event: unknown) => {
      const handlerStartedAt =
        typeof performance !== 'undefined' ? performance.now() : Date.now();

      // TEMP: Android dt 분포 + JSON.parse 비용
      let eventForNormalize: unknown = event;
      let parseMs = 0;
      if (TEMP_DT_DISTRIBUTION) {
        if (dtWindowIndexRef.current === 0 && dtSamplesRef.current.length === 0 && dtLastAtRef.current === 0) {
          console.log(
            '[TEMP dt-distribution] armed',
            JSON.stringify({
              platform: Platform.OS,
              eventType: typeof event,
              windowSamples: TEMP_DT_WINDOW_SAMPLES,
            }),
          );
        }

        if (typeof event === 'string') {
          const parseStartedAt =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
          try {
            eventForNormalize = JSON.parse(event);
          } catch {
            eventForNormalize = event;
          }
          parseMs =
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
            parseStartedAt;
          parseMsSamplesRef.current.push(parseMs);
        }

        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (dtLastAtRef.current > 0) {
          const dtMs = now - dtLastAtRef.current;
          dtSamplesRef.current.push(dtMs);
          if (dtSamplesRef.current.length >= TEMP_DT_WINDOW_SAMPLES) {
            dtWindowIndexRef.current += 1;
            const dtStats = summarizeDtSamples(dtSamplesRef.current);
            const parseStats = summarizeMsSamples(parseMsSamplesRef.current);
            const handlerStats = summarizeMsSamples(handlerMsSamplesRef.current);
            console.log(
              '[TEMP dt-distribution]',
              JSON.stringify({
                platform: Platform.OS,
                window: dtWindowIndexRef.current,
                eventType: typeof event,
                dt: dtStats,
                jsonParseMs: parseStats,
                prevWindowHandlerMs: handlerStats,
                note:
                  'spikesOver120/250 = dt 스파이크 횟수. jsonParseMs는 문자열 페이로드일 때만.',
              }),
            );
            dtSamplesRef.current = [];
            parseMsSamplesRef.current = [];
            handlerMsSamplesRef.current = [];
          }
        }
        dtLastAtRef.current = now;
      }

      // TEMP: raw dump + FPS/스키마 진단 (검증 후 TEMP_LANDMARK_DIAGNOSTICS=false)
      if (TEMP_LANDMARK_DIAGNOSTICS) {
        diagWindowCountRef.current += 1;
        const now = Date.now();
        const elapsedMs = now - diagWindowStartRef.current;

        let rawForJson: unknown = eventForNormalize;
        if (typeof eventForNormalize === 'string') {
          try {
            rawForJson = JSON.parse(eventForNormalize);
          } catch {
            rawForJson = eventForNormalize;
          }
        }

        const landmarksArray = Array.isArray(
          (rawForJson as { landmarks?: unknown })?.landmarks,
        )
          ? (rawForJson as { landmarks: unknown[] }).landmarks
          : [];

        // 초당 1회: FPS + 개수 + 손목 좌표
        if (elapsedMs >= 1000) {
          const fps = diagWindowCountRef.current / (elapsedMs / 1000);
          const fields = inspectLandmarkFields(landmarksArray);
          console.log(
            '[TEMP onLandmark raw]',
            JSON.stringify({
              fps: Number(fps.toFixed(1)),
              callbacksInWindow: diagWindowCountRef.current,
              landmarkCount: fields.count,
              hasXYZV: fields.hasXYZV,
              sampleKeys: fields.sampleKeys,
              leftWrist: landmarksArray[LANDMARK_INDEX.left_wrist] ?? null,
              rightWrist: landmarksArray[LANDMARK_INDEX.right_wrist] ?? null,
            }),
          );

          // 포즈가 잡힌 경우 전체 payload JSON.stringify (3초에 1회, 로그 폭주 방지)
          if (fields.count > 0 && now - diagFullDumpAtRef.current >= 3000) {
            console.log(
              '[TEMP onLandmark JSON.stringify(data)]',
              JSON.stringify(rawForJson),
            );
            diagFullDumpAtRef.current = now;
          }

          diagWindowStartRef.current = now;
          diagWindowCountRef.current = 0;
        }
      }

      const normalizedEvent = normalizeLandmarkEvent(eventForNormalize);
      if (!normalizedEvent?.landmarks?.length) {
        // 포즈 소실은 즉시 UI/스켈레톤 클리어 (스로틀 적용 안 함)
        clearPoseUi();

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
        if (TEMP_DT_DISTRIBUTION) {
          const endedAt =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
          handlerMsSamplesRef.current.push(endedAt - handlerStartedAt);
        }
        return;
      }

      const poseLandmarks = normalizedEvent.landmarks;
      const frameSize = normalizedEvent.frameSize;
      const visibility = averageVisibility(poseLandmarks);

      // 사람 없음/저신뢰 프레임은 스켈레톤을 고스트로 남기지 않음
      if (isPoseEffectivelyAbsent(poseLandmarks, visibility)) {
        clearPoseUi();
        if (TEMP_DT_DISTRIBUTION) {
          const endedAt =
            typeof performance !== 'undefined' ? performance.now() : Date.now();
          handlerMsSamplesRef.current.push(endedAt - handlerStartedAt);
        }
        return;
      }

      // 유효 포즈 시각 — 스로틀과 무관 (스텔니스 클리어용)
      lastValidPoseAtRef.current = Date.now();

      frameCountRef.current += 1;
      const nextCount = frameCountRef.current;

      const nowEma =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dtMs =
        emaLastAtRef.current > 0 ? nowEma - emaLastAtRef.current : 0;
      emaLastAtRef.current = nowEma;
      const alpha = emaAlphaFromDt(dtMs, smoothingTauMs);
      const smoothed = smoothLandmarksEma(
        smoothedPrevRef.current,
        poseLandmarks,
        alpha,
      );
      smoothedPrevRef.current = smoothed;

      if (TEMP_LATENCY_DIAGNOSTICS) {
        const now = Date.now();
        if (now - latencyLogAtRef.current >= 500) {
          latencyLogAtRef.current = now;
          const rawW = poseLandmarks[LANDMARK_INDEX.right_wrist];
          const smW = smoothed[LANDMARK_INDEX.right_wrist];
          const lagX = rawW && smW ? Number((rawW.x - smW.x).toFixed(4)) : null;
          const lagY = rawW && smW ? Number((rawW.y - smW.y).toFixed(4)) : null;
          console.log(
            '[TEMP latency]',
            JSON.stringify({
              platform: Platform.OS,
              dtMs: Number(dtMs.toFixed(1)),
              approxFps: dtMs > 0 ? Number((1000 / dtMs).toFixed(1)) : null,
              tauMs: smoothingTauMs,
              alpha: alpha == null ? 'snap' : Number(alpha.toFixed(3)),
              rawRightWrist: rawW
                ? { x: Number(rawW.x.toFixed(4)), y: Number(rawW.y.toFixed(4)) }
                : null,
              smoothedRightWrist: smW
                ? { x: Number(smW.x.toFixed(4)), y: Number(smW.y.toFixed(4)) }
                : null,
              rawMinusSmoothed: { x: lagX, y: lagY },
            }),
          );
        }
      }

      // 원본 → 녹화 버퍼(ref push만). 스무딩본 → Skia SharedValue (표시용, 뷰 픽셀).
      onRawFrameRefStable.current?.current?.(poseLandmarks);
      if (displayPointsSVRef.current) {
        const viewSize = viewSizeRefStable.current?.current ?? {
          width: 0,
          height: 0,
        };
        displayPointsSVRef.current.value = packPosePoints(smoothed, {
          viewWidth: viewSize.width,
          viewHeight: viewSize.height,
          imageWidth: frameSize?.width ?? 0,
          imageHeight: frameSize?.height ?? 0,
        });
      }

      // 상태바용 setState만 스로틀 — 매 프레임 React 리렌더는 Android JS 스톨 유발
      const nowUi = Date.now();
      if (nowUi - lastUiStateAtRef.current >= UI_STATE_MIN_INTERVAL_MS) {
        lastUiStateAtRef.current = nowUi;
        setRawLandmarks(poseLandmarks);
        setLandmarks(smoothed);
        setAvgVisibility(visibility);
        setFrameCount(nextCount);
        setLastUpdatedAtMs(nowUi);
      }

      if (enableLogging && nextCount % LOG_EVERY_N_FRAMES === 0) {
        const leftWrist = poseLandmarks[LANDMARK_INDEX.left_wrist];
        const rightWrist = poseLandmarks[LANDMARK_INDEX.right_wrist];
        console.log('[usePoseLandmarks]', {
          frame: nextCount,
          count: poseLandmarks.length,
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

      if (TEMP_DT_DISTRIBUTION) {
        const endedAt =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        handlerMsSamplesRef.current.push(endedAt - handlerStartedAt);
      }
    },
    [clearPoseUi, enableLogging, smoothingTauMs],
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
