/**
 * 스윙 영상(+스켈레톤) 또는 실시간 좌표만 스켈레톤 리뷰.
 */

import { useEventListener } from 'expo';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhaseTimeline, {
  findCurrentPhase,
} from '../components/PhaseTimeline';
import SkeletonOverlay, {
  createEmptyPackedPosePoints,
  packPosePoints,
} from '../components/SkeletonOverlay';
import type {
  LandmarkFrame,
  PhaseMarker,
  PoseLandmarks,
  SwingPhase,
} from '../lib/landmarkTypes';
import { segmentSwingPhases } from '../lib/phaseSegmentation';
import { smoothLandmarksEma } from '../lib/landmarkSmoothing';
import {
  createSwingVideoSignedUrl,
  fetchSwingPlaybackSession,
  interpolatePoseAtMs,
} from '../../../services/supabase/swingPlayback';
import { useAuth } from '@/features/auth/hooks/useAuth';

/** 슬로우~정상 배속 범위 */
const RATE_MIN = 0.25;
const RATE_MAX = 1;
const RATE_DEFAULT = 1;
/** 네이티브 플레이어가 전달하는 고빈도 미디어 시계를 영상 동기화의 단일 기준으로 사용 */
const VIDEO_TIME_UPDATE_INTERVAL_SECONDS = 1 / 60;
/**
 * Android: 앵커를 더 촘촘히 (rAF에서는 currentTime 미호출).
 * expo-video는 양수 interval만 요구 — 하한 문서화 없음. 90Hz로 denser anchors.
 */
const ANDROID_VIDEO_TIME_UPDATE_INTERVAL_SECONDS = 1 / 90;
/**
 * soft clock 앵커 보정: timeUpdate마다 예측→실측 오차의 일부만 반영 (저역통과).
 * 1이면 하드 스냅. 큰 오차(|err|≥SNAP)는 즉시 스냅.
 */
const ANDROID_CLOCK_CORRECTION_BLEND = 0.38;
const ANDROID_CLOCK_SNAP_ERR_SEC = 0.28;
/** 늦은 timeUpdate snap-back은 더 약하게 흡수 */
const ANDROID_CLOCK_LATE_BLEND = 0.12;
/**
 * Android 리뷰 표시용 고정 α EMA — 잔여 지터만 가림. sync 오프셋과 분리.
 * (촬영 Gate 2/3 landmarkSmoothing τ 경로와 공유하지 않음)
 */
const ANDROID_REVIEW_DISPLAY_EMA_ALPHA = 0.42;
/**
 * 리뷰 전용: 영상 currentTime → pose 조회 시각 보정 (live 캡처만).
 * poseTimeMs = videoCurrentTimeSec * 1000 + PLATFORM_REVIEW_SKELETON_OFFSET_MS
 *
 * - 업로드 분석 프레임은 영상 추출 시각과 1:1이라 0.
 * - 라이브는 Date.now 스탬프 vs 인코딩/플레이어 표시 시각 어긋남 + 플랫폼별
 *   시계 API(iOS timeUpdate / Android soft clock) 차이로 방향이 갈린다.
 * - iOS: 스켈레톤이 영상보다 늦음 → 양의 오프셋으로 pose를 앞당겨 catch-up
 * - Android: 예전 450ms 리드는 리뷰에서 약간 앞섬 → 보수적으로 축소
 * 촬영(Gate 2/3) 경로와 공유하지 말 것.
 */
const IOS_REVIEW_SKELETON_OFFSET_MS = 180;
const ANDROID_REVIEW_SKELETON_OFFSET_MS = 320;

function reviewSkeletonOffsetMs(isLiveCapture: boolean): number {
  if (!isLiveCapture) {
    return 0;
  }
  return Platform.OS === 'android'
    ? ANDROID_REVIEW_SKELETON_OFFSET_MS
    : Platform.OS === 'ios'
      ? IOS_REVIEW_SKELETON_OFFSET_MS
      : 0;
}

/** 리뷰 VideoView 매핑용 프레임 비율 — Android 분석/카메라는 4:3(세로 3:4) */
const REVIEW_FRAME_WIDTH_IOS = 1080;
const REVIEW_FRAME_HEIGHT_IOS = 1920;
const REVIEW_FRAME_WIDTH_ANDROID = 1080;
const REVIEW_FRAME_HEIGHT_ANDROID = 1440;

function clampRate(value: number): number {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, value));
}

function formatRate(rate: number): string {
  const rounded = Math.round(rate * 100) / 100;
  return `${rounded}x`;
}

function snapRate(value: number): number {
  return clampRate(Math.round(value * 20) / 20);
}

type RateSliderProps = {
  initialValue?: number;
  /** 플레이어 배속 반영 — 부모 setState 없이 player에 직접 적용할 것 */
  onRateChange: (rate: number) => void;
};

/**
 * 배속 슬라이더.
 * Android: 드래그 중엔 UI만 갱신하고, 손을 뗄 때 playbackRate 적용
 * (드래그마다 rate 바꾸면 ExoPlayer/VideoView가 깜박임).
 */
function RateSlider({
  initialValue = RATE_DEFAULT,
  onRateChange,
}: RateSliderProps) {
  const [displayRate, setDisplayRate] = useState(initialValue);
  const trackRef = useRef<View>(null);
  const trackPageXRef = useRef(0);
  const trackWidthRef = useRef(0);
  const displayRateRef = useRef(initialValue);
  const onRateChangeRef = useRef(onRateChange);
  onRateChangeRef.current = onRateChange;

  const commitRate = useCallback((rate: number) => {
    const next = snapRate(rate);
    displayRateRef.current = next;
    setDisplayRate(next);
    onRateChangeRef.current(next);
  }, []);

  const previewRate = useCallback((rate: number) => {
    const next = snapRate(rate);
    if (next === displayRateRef.current) {
      return;
    }
    displayRateRef.current = next;
    setDisplayRate(next);
    // iOS는 드래그 중 즉시 반영해도 안정적
    if (Platform.OS !== 'android') {
      onRateChangeRef.current(next);
    }
  }, []);

  const rateFromPageX = useCallback((pageX: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) {
      return displayRateRef.current;
    }
    const t = Math.min(1, Math.max(0, (pageX - trackPageXRef.current) / width));
    return RATE_MIN + t * (RATE_MAX - RATE_MIN);
  }, []);

  const measureTrack = useCallback(() => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackPageXRef.current = x;
      trackWidthRef.current = width;
    });
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          measureTrack();
          // measureInWindow가 비동기일 수 있어 locationX 폴백
          const { pageX, locationX } = evt.nativeEvent;
          if (trackWidthRef.current > 0) {
            previewRate(rateFromPageX(pageX));
          } else {
            const width = trackWidthRef.current || 1;
            const t = Math.min(1, Math.max(0, locationX / width));
            previewRate(RATE_MIN + t * (RATE_MAX - RATE_MIN));
          }
        },
        onPanResponderMove: (evt) => {
          previewRate(rateFromPageX(evt.nativeEvent.pageX));
        },
        onPanResponderRelease: () => {
          commitRate(displayRateRef.current);
        },
        onPanResponderTerminate: () => {
          commitRate(displayRateRef.current);
        },
      }),
    [commitRate, measureTrack, previewRate, rateFromPageX],
  );

  const ratio = (displayRate - RATE_MIN) / (RATE_MAX - RATE_MIN);

  return (
    <View style={styles.rateBlock}>
      <View style={styles.rateHeader}>
        <Text style={styles.rateLabel}>배속</Text>
        <Text style={styles.rateValue}>{formatRate(displayRate)}</Text>
      </View>
      <View
        ref={trackRef}
        style={styles.rateTrackHit}
        onLayout={(e) => {
          trackWidthRef.current = e.nativeEvent.layout.width;
          measureTrack();
        }}
        {...panResponder.panHandlers}
      >
        <View style={styles.rateTrack}>
          <View style={[styles.rateFill, { width: `${ratio * 100}%` }]} />
          <View
            pointerEvents="none"
            style={[styles.rateThumb, { left: `${ratio * 100}%` }]}
          />
        </View>
      </View>
      <View style={styles.rateTicks}>
        <Text style={styles.rateTick}>{formatRate(RATE_MIN)}</Text>
        <Text style={styles.rateTick}>0.5x</Text>
        <Text style={styles.rateTick}>{formatRate(RATE_MAX)}</Text>
      </View>
    </View>
  );
}

export default function SwingReviewScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { sessionId: rawId } = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  /** 영상 없이 좌표만 재생 */
  const [skeletonOnly, setSkeletonOnly] = useState(false);
  /** 전면 카메라 좌표를 저장 영상 방향에 맞춰 좌우 보정 */
  const [mirrorSkeleton, setMirrorSkeleton] = useState(false);
  const [frames, setFrames] = useState<LandmarkFrame[]>([]);
  const [phases, setPhases] = useState<PhaseMarker[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<SwingPhase | null>(null);

  const pointsSV = useSharedValue(createEmptyPackedPosePoints());
  const framesRef = useRef<LandmarkFrame[]>([]);
  framesRef.current = frames;
  const phasesRef = useRef<PhaseMarker[]>([]);
  phasesRef.current = phases;
  const playbackRateRef = useRef(RATE_DEFAULT);
  const skeletonTimeMsRef = useRef(0);
  const skeletonRafRef = useRef<number | null>(null);
  const skeletonLastTickRef = useRef<number | null>(null);
  const durationMsRef = useRef(0);
  /** 트리밍된 스윙 윈도우 (원본 영상 타임라인 기준) */
  const windowStartMsRef = useRef(0);
  const windowEndMsRef = useRef(0);
  const currentPhaseRef = useRef<SwingPhase | null>(null);
  const latestMediaTimeMsRef = useRef(0);
  /** iOS: seek 직후 play 무시·반복 seek 경합 방지 */
  const windowLoopLockRef = useRef(false);
  const userPausedRef = useRef(false);
  const mirrorSkeletonRef = useRef(false);
  mirrorSkeletonRef.current = mirrorSkeleton;
  const androidVideoSyncRafRef = useRef<number | null>(null);
  /**
   * Android soft media clock.
   * expo-video Android `currentTime` getter는 매 호출마다 mainQueue runBlocking 이라
   * rAF마다 읽으면 JS/UI가 끊긴다. timeUpdate로 앵커만 갱신하고, 프레임 사이는
   * 벽시계×배속으로 보간해 pose를 매 rAF 연속 갱신한다.
   */
  const androidMediaClockRef = useRef<{
    sampleSec: number;
    wallMs: number;
    valid: boolean;
  }>({ sampleSec: 0, wallMs: 0, valid: false });
  /** Android 리뷰 표시 EMA 상태 — seek/루프 시 리셋 */
  const androidReviewDisplayPoseRef = useRef<PoseLandmarks | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.playbackRate = RATE_DEFAULT;
    p.preservesPitch = true;
    p.timeUpdateEventInterval =
      Platform.OS === 'android'
        ? ANDROID_VIDEO_TIME_UPDATE_INTERVAL_SECONDS
        : VIDEO_TIME_UPDATE_INTERVAL_SECONDS;
  });
  const playerRef = useRef(player);
  playerRef.current = player;

  const resetAndroidMediaClock = useCallback(
    (currentTimeSec: number, force = false) => {
      if (!Number.isFinite(currentTimeSec)) {
        androidMediaClockRef.current.valid = false;
        return;
      }
      const now = performance.now();
      const prev = androidMediaClockRef.current;
      if (force || !prev.valid) {
        androidMediaClockRef.current = {
          sampleSec: currentTimeSec,
          wallMs: now,
          valid: true,
        };
        return;
      }
      const predicted =
        prev.sampleSec +
        ((now - prev.wallMs) / 1000) * playbackRateRef.current;
      const errSec = currentTimeSec - predicted;
      const absErr = Math.abs(errSec);
      // 큰 점프(버퍼/시크)는 즉시 스냅, 그 외는 오차의 일부만 흡수해 hitch 방지
      let blend = ANDROID_CLOCK_CORRECTION_BLEND;
      if (absErr >= ANDROID_CLOCK_SNAP_ERR_SEC) {
        blend = 1;
      } else if (errSec < 0 && errSec > -0.12) {
        blend = ANDROID_CLOCK_LATE_BLEND;
      }
      androidMediaClockRef.current = {
        sampleSec: predicted + blend * errSec,
        wallMs: now,
        valid: true,
      };
    },
    [],
  );

  const invalidateAndroidMediaClock = useCallback(() => {
    androidMediaClockRef.current.valid = false;
  }, []);

  const resetAndroidReviewDisplaySmoothing = useCallback(() => {
    androidReviewDisplayPoseRef.current = null;
  }, []);

  const predictAndroidCurrentTimeSec = useCallback((): number | null => {
    const clock = androidMediaClockRef.current;
    if (!clock.valid) {
      return null;
    }
    const elapsedSec = (performance.now() - clock.wallMs) / 1000;
    return clock.sampleSec + elapsedSec * playbackRateRef.current;
  }, []);

  const applyPlaybackRate = useCallback(
    (rate: number) => {
      const next = clampRate(rate);
      playbackRateRef.current = next;
      if (!player || skeletonOnly) {
        return;
      }
      try {
        if (player.playbackRate === next) {
          return;
        }
        player.playbackRate = next;
        player.preservesPitch = true;
        // 배속 변경 직후 soft clock 재앵커 (이전 배속으로 예측이 어긋나지 않게)
        if (Platform.OS === 'android') {
          resetAndroidReviewDisplaySmoothing();
          resetAndroidMediaClock(player.currentTime, true);
        }
      } catch (e) {
        console.warn('[SwingReview] playbackRate', e);
      }
    },
    [player, resetAndroidMediaClock, resetAndroidReviewDisplaySmoothing, skeletonOnly],
  );

  const applyFrameAtMs = useCallback(
    (timeMs: number) => {
      const list = framesRef.current;
      if (list.length === 0 || layout.width <= 0 || layout.height <= 0) {
        return;
      }
      // 시간 보간(성긴 프레임은 Catmull). React setState 없이 SharedValue만 갱신.
      const interpolated = interpolatePoseAtMs(list, timeMs);
      if (!interpolated) {
        return;
      }
      let pose: PoseLandmarks = interpolated;
      // Android 리뷰만 가벼운 표시 EMA — timing sync와 분리된 residual jitter 완화
      if (Platform.OS === 'android') {
        pose = smoothLandmarksEma(
          androidReviewDisplayPoseRef.current,
          pose,
          ANDROID_REVIEW_DISPLAY_EMA_ALPHA,
        );
        androidReviewDisplayPoseRef.current = pose;
      }
      const landmarks = mirrorSkeleton
        ? pose.map((point) => ({ ...point, x: 1 - point.x }))
        : pose;
      // Android: 라이브 fillCenter + ExoPlayer cover(ZOOM) = cover+center
      // iOS: cover+center (기존)
      pointsSV.value = packPosePoints(landmarks, {
        viewWidth: layout.width,
        viewHeight: layout.height,
        imageWidth:
          Platform.OS === 'android'
            ? REVIEW_FRAME_WIDTH_ANDROID
            : REVIEW_FRAME_WIDTH_IOS,
        imageHeight:
          Platform.OS === 'android'
            ? REVIEW_FRAME_HEIGHT_ANDROID
            : REVIEW_FRAME_HEIGHT_IOS,
        align: 'center',
      });
    },
    [layout.height, layout.width, mirrorSkeleton, pointsSV],
  );

  const updateCurrentPhaseAtMs = useCallback((timeMs: number) => {
    const nextPhase = findCurrentPhase(phasesRef.current, timeMs);
    if (nextPhase === currentPhaseRef.current) {
      return;
    }
    currentPhaseRef.current = nextPhase;
    setCurrentPhase(nextPhase);
  }, []);

  const applyMediaTimeMs = useCallback(
    (timeMs: number) => {
      if (!Number.isFinite(timeMs)) {
        return;
      }
      const safeTimeMs = Math.max(0, timeMs);
      latestMediaTimeMsRef.current = safeTimeMs;
      applyFrameAtMs(safeTimeMs);
      updateCurrentPhaseAtMs(safeTimeMs);
    },
    [applyFrameAtMs, updateCurrentPhaseAtMs],
  );

  /**
   * 스윙 윈도우 시작으로 되돌리고 재생.
   * iOS AVPlayer는 seek 직후 play()가 무시되는 경우가 있어 rAF+짧은 지연으로 한 번 더 건다.
   */
  const restartSwingWindowPlayback = useCallback(() => {
    if (!player || skeletonOnly || userPausedRef.current) {
      return;
    }
    if (windowLoopLockRef.current) {
      return;
    }
    windowLoopLockRef.current = true;
    const startMs = windowStartMsRef.current;
    const startSec = startMs / 1000;
    try {
      player.currentTime = startSec;
      if (Platform.OS === 'android') {
        resetAndroidReviewDisplaySmoothing();
        resetAndroidMediaClock(startSec, true);
      }
      applyMediaTimeMs(startMs);
    } catch (e) {
      console.warn('[SwingReview] window seek', e);
      windowLoopLockRef.current = false;
      return;
    }

    const tryPlay = () => {
      try {
        if (!userPausedRef.current) {
          player.play();
          setPlaying(true);
        }
      } catch (e) {
        console.warn('[SwingReview] window play', e);
      }
    };

    tryPlay();
    requestAnimationFrame(() => {
      tryPlay();
      setTimeout(() => {
        tryPlay();
        windowLoopLockRef.current = false;
      }, 80);
    });
  }, [
    applyMediaTimeMs,
    player,
    resetAndroidMediaClock,
    resetAndroidReviewDisplaySmoothing,
    skeletonOnly,
  ]);

  const syncSkeletonToVideoTime = useCallback(
    (currentTimeSec: number) => {
      if (skeletonOnly || !signedUrl || userPausedRef.current) {
        return;
      }
      if (!Number.isFinite(currentTimeSec)) {
        return;
      }
      // 루프 판정은 보정 전 영상 시계 기준 (윈도우 start/end = 원본 timestampMs)
      const rawMs = currentTimeSec * 1000;
      const start = windowStartMsRef.current;
      const end = windowEndMsRef.current;
      if (rawMs >= end - 30 || rawMs < start - 40) {
        restartSwingWindowPlayback();
        return;
      }
      const offsetMs = reviewSkeletonOffsetMs(mirrorSkeletonRef.current);
      const timeMs = rawMs + offsetMs;
      // offset으로 end를 넘기면 마지막 프레임에 고정 (루프는 rawMs가 처리)
      if (timeMs > end && offsetMs > 0) {
        applyMediaTimeMs(end);
        return;
      }
      applyMediaTimeMs(Math.min(end, Math.max(start, timeMs)));
    },
    [applyMediaTimeMs, restartSwingWindowPlayback, signedUrl, skeletonOnly],
  );

  const stopAndroidVideoSyncLoop = useCallback(() => {
    if (androidVideoSyncRafRef.current != null) {
      cancelAnimationFrame(androidVideoSyncRafRef.current);
      androidVideoSyncRafRef.current = null;
    }
  }, []);

  const tickAndroidVideoSync = useCallback(() => {
    androidVideoSyncRafRef.current = null;
    if (
      Platform.OS !== 'android' ||
      skeletonOnly ||
      !player ||
      userPausedRef.current
    ) {
      return;
    }
    try {
      if (player.playing) {
        // hot path에서는 currentTime getter(runBlocking)를 쓰지 않는다
        let t = predictAndroidCurrentTimeSec();
        if (t == null) {
          t = player.currentTime;
          resetAndroidMediaClock(t, true);
        }
        syncSkeletonToVideoTime(t);
      }
    } catch {
      // ignore
    }
    androidVideoSyncRafRef.current = requestAnimationFrame(tickAndroidVideoSync);
  }, [
    player,
    predictAndroidCurrentTimeSec,
    resetAndroidMediaClock,
    skeletonOnly,
    syncSkeletonToVideoTime,
  ]);

  const startAndroidVideoSyncLoop = useCallback(() => {
    if (Platform.OS !== 'android' || skeletonOnly) {
      return;
    }
    stopAndroidVideoSyncLoop();
    androidVideoSyncRafRef.current = requestAnimationFrame(tickAndroidVideoSync);
  }, [skeletonOnly, stopAndroidVideoSyncLoop, tickAndroidVideoSync]);

  // 레이아웃·미러 설정·세션 프레임이 바뀌면 같은 시각으로 다시 패킹한다.
  useEffect(() => {
    androidReviewDisplayPoseRef.current = null;
    applyMediaTimeMs(latestMediaTimeMsRef.current);
  }, [applyMediaTimeMs, frames]);

  const stopSkeletonLoop = useCallback(() => {
    if (skeletonRafRef.current != null) {
      cancelAnimationFrame(skeletonRafRef.current);
      skeletonRafRef.current = null;
    }
    skeletonLastTickRef.current = null;
  }, []);

  const tickSkeleton = useCallback(() => {
    const now = performance.now();
    const last = skeletonLastTickRef.current ?? now;
    skeletonLastTickRef.current = now;
    const dt = (now - last) * playbackRateRef.current;
    const start = windowStartMsRef.current;
    const end = Math.max(start + 1, windowEndMsRef.current);
    const span = end - start;
    let next = skeletonTimeMsRef.current + dt;
    if (next > end) {
      next = start + ((next - start) % span);
    }
    if (next < start) {
      next = start;
    }
    skeletonTimeMsRef.current = next;
    applyMediaTimeMs(next);
    skeletonRafRef.current = requestAnimationFrame(tickSkeleton);
  }, [applyMediaTimeMs]);

  const startSkeletonLoop = useCallback(() => {
    stopSkeletonLoop();
    skeletonLastTickRef.current = performance.now();
    skeletonRafRef.current = requestAnimationFrame(tickSkeleton);
  }, [stopSkeletonLoop, tickSkeleton]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) {
        setError('세션 ID가 없어요');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setSignedUrl(null);
      setFrames([]);
      setPhases([]);
      setHint(null);
      setSkeletonOnly(false);
      setMirrorSkeleton(false);
      setCurrentPhase(null);
      currentPhaseRef.current = null;
      latestMediaTimeMsRef.current = 0;
      skeletonTimeMsRef.current = 0;
      windowStartMsRef.current = 0;
      windowEndMsRef.current = 0;
      try {
        const session = await fetchSwingPlaybackSession(sessionId);
        if (cancelled) {
          return;
        }
        if (!session) {
          setError('세션을 찾을 수 없어요');
          return;
        }
        if (
          session.status === 'pending' ||
          session.status === 'processing'
        ) {
          setError('아직 분석 중이에요. 완료된 뒤 다시 열어 주세요.');
          return;
        }

        setFrames(session.frames);
        const resolvedPhases =
          session.phases.length > 0
            ? session.phases
            : session.frames.length > 0
              ? segmentSwingPhases(session.frames, {
                  dominantHand: profile?.dominant_hand ?? null,
                }).phases
              : [];
        setPhases(resolvedPhases);

        const firstTs = session.frames[0]?.timestampMs ?? 0;
        const lastTs =
          session.frames[session.frames.length - 1]?.timestampMs ?? firstTs;
        windowStartMsRef.current = firstTs;
        windowEndMsRef.current = Math.max(firstTs + 1, lastTs);
        durationMsRef.current = Math.max(
          session.durationMs,
          windowEndMsRef.current - windowStartMsRef.current,
          1,
        );
        skeletonTimeMsRef.current = firstTs;
        latestMediaTimeMsRef.current = firstTs;

        if (session.localVideoUri) {
          if (cancelled) {
            return;
          }
          setSignedUrl(session.localVideoUri);
          setSkeletonOnly(false);
          setMirrorSkeleton(session.captureMode === 'live');
          if (session.frames.length === 0) {
            setHint('좌표 프레임이 없어 영상만 재생해요');
          } else if (resolvedPhases.length === 0) {
            setHint('구간(어드레스~피니시) 정보가 없어요');
          } else {
            setHint(null);
          }
        } else if (session.videoUrl) {
          const url = await createSwingVideoSignedUrl(session.videoUrl);
          if (cancelled) {
            return;
          }
          if (!url) {
            setError('영상 URL을 만들지 못했어요');
            return;
          }
          setSignedUrl(url);
          setSkeletonOnly(false);
          setMirrorSkeleton(session.captureMode === 'live');
          if (session.frames.length === 0) {
            setHint('좌표 프레임이 없어 영상만 재생해요');
          } else if (resolvedPhases.length === 0) {
            setHint('구간(어드레스~피니시) 정보가 없어요');
          } else {
            setHint(null);
          }
        } else if (session.frames.length > 0) {
          setSignedUrl(null);
          setSkeletonOnly(true);
          setMirrorSkeleton(false);
          setHint('저장된 스윙 좌표를 스켈레톤으로 재생해요');
        } else {
          setError('재생할 영상이 없어요');
          return;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '불러오기 실패');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      stopSkeletonLoop();
      stopAndroidVideoSyncLoop();
    };
  }, [sessionId, stopSkeletonLoop, stopAndroidVideoSyncLoop, profile?.dominant_hand]);

  // 제스처 back 등으로 onClose 를 안 타도 오디오 세션을 풀어 촬영 TTS가 다시 나가게
  useFocusEffect(
    useCallback(() => {
      return () => {
        stopSkeletonLoop();
        stopAndroidVideoSyncLoop();
        try {
          playerRef.current?.pause();
        } catch {
          // ignore
        }
      };
    }, [stopSkeletonLoop, stopAndroidVideoSyncLoop]),
  );

  useEffect(() => {
    if (!signedUrl || !player || skeletonOnly) {
      return;
    }
    userPausedRef.current = false;
    windowLoopLockRef.current = false;
    try {
      player.loop = false;
      player.replace(signedUrl);
      player.playbackRate = playbackRateRef.current;
      player.preservesPitch = true;
      // Android: denser timeUpdate anchors (soft clock만 보정, rAF currentTime 금지)
      player.timeUpdateEventInterval =
        Platform.OS === 'android'
          ? ANDROID_VIDEO_TIME_UPDATE_INTERVAL_SECONDS
          : VIDEO_TIME_UPDATE_INTERVAL_SECONDS;
      const timer = setTimeout(() => {
        restartSwingWindowPlayback();
        startAndroidVideoSyncLoop();
      }, 60);
      return () => {
        clearTimeout(timer);
        stopAndroidVideoSyncLoop();
      };
    } catch (e) {
      console.warn('[SwingReview] replace', e);
    }
  }, [
    signedUrl,
    player,
    skeletonOnly,
    restartSwingWindowPlayback,
    startAndroidVideoSyncLoop,
    stopAndroidVideoSyncLoop,
  ]);

  // 스켈레톤 전용: 로드·레이아웃 준비되면 자동 재생
  useEffect(() => {
    if (!skeletonOnly || loading || error || frames.length === 0) {
      return;
    }
    if (layout.width <= 0 || layout.height <= 0) {
      return;
    }
    skeletonTimeMsRef.current = windowStartMsRef.current;
    applyMediaTimeMs(windowStartMsRef.current);
    setPlaying(true);
    startSkeletonLoop();
    return () => {
      stopSkeletonLoop();
    };
  }, [
    skeletonOnly,
    loading,
    error,
    frames.length,
    layout.width,
    layout.height,
    applyMediaTimeMs,
    startSkeletonLoop,
    stopSkeletonLoop,
  ]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (Platform.OS === 'android') {
      // pose는 rAF soft clock이 담당. timeUpdate는 앵커만 갱신 (seek 중 제외).
      if (
        !userPausedRef.current &&
        !windowLoopLockRef.current &&
        Number.isFinite(currentTime)
      ) {
        resetAndroidMediaClock(currentTime);
      }
      return;
    }
    syncSkeletonToVideoTime(currentTime);
  });

  useEventListener(player, 'playToEnd', () => {
    if (skeletonOnly || !signedUrl || userPausedRef.current) {
      return;
    }
    restartSwingWindowPlayback();
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (skeletonOnly) {
      return;
    }
    setPlaying(isPlaying);
    if (Platform.OS === 'android') {
      if (isPlaying && !userPausedRef.current) {
        try {
          resetAndroidReviewDisplaySmoothing();
          resetAndroidMediaClock(player.currentTime, true);
        } catch {
          // ignore
        }
        startAndroidVideoSyncLoop();
      } else {
        invalidateAndroidMediaClock();
        stopAndroidVideoSyncLoop();
      }
    }
    // iOS가 윈도우 끝에서 멈춘 경우, 사용자 pause가 아니면 루프 재개
    if (!isPlaying && !userPausedRef.current && signedUrl) {
      const nowMs = latestMediaTimeMsRef.current;
      const end = windowEndMsRef.current;
      if (nowMs >= end - 80) {
        restartSwingWindowPlayback();
      }
    }
  });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  const togglePlay = () => {
    if (skeletonOnly) {
      if (playing) {
        stopSkeletonLoop();
        setPlaying(false);
      } else {
        setPlaying(true);
        startSkeletonLoop();
      }
      return;
    }
    if (!player) {
      return;
    }
    if (player.playing) {
      userPausedRef.current = true;
      invalidateAndroidMediaClock();
      stopAndroidVideoSyncLoop();
      player.pause();
    } else {
      userPausedRef.current = false;
      try {
        resetAndroidReviewDisplaySmoothing();
        resetAndroidMediaClock(player.currentTime, true);
      } catch {
        // ignore
      }
      player.play();
      startAndroidVideoSyncLoop();
    }
  };

  const onClose = () => {
    stopSkeletonLoop();
    stopAndroidVideoSyncLoop();
    try {
      player?.pause();
    } catch {
      // ignore
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/capture');
    }
  };

  const showStage = !loading && !error && (signedUrl != null || skeletonOnly);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topbar}>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <Text style={styles.backBtnText}>닫기</Text>
        </Pressable>
        <Text style={styles.title}>스윙 리뷰</Text>
        <View style={{ width: 56 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#8971EA" />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {showStage ? (
        <View style={styles.stageArea}>
          <View style={styles.stageWrap}>
            <View style={styles.stage} onLayout={onLayout}>
              {signedUrl ? (
                <VideoView
                  style={StyleSheet.absoluteFill}
                  player={player}
                  contentFit="cover"
                  nativeControls={false}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.skeletonStage]} />
              )}
              {layout.width > 0 && layout.height > 0 && frames.length > 0 ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <SkeletonOverlay
                    pointsSV={pointsSV}
                    width={layout.width}
                    height={layout.height}
                  />
                </View>
              ) : null}
              {phases.length > 0 ? (
                <View style={styles.phaseOverlay} pointerEvents="none">
                  <PhaseTimeline
                    phases={phases}
                    currentPhase={currentPhase}
                  />
                </View>
              ) : null}
            </View>
          </View>

          {hint ? <Text style={styles.hintOverlay}>{hint}</Text> : null}

          <View
            style={[styles.controlsOverlay, { paddingBottom: insets.bottom + 12 }]}
            pointerEvents="box-none"
          >
            <RateSlider
              initialValue={RATE_DEFAULT}
              onRateChange={applyPlaybackRate}
            />
            <Pressable
              accessibilityRole="button"
              onPress={togglePlay}
              style={({ pressed }) => [
                styles.playBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.playBtnText}>
                {playing ? '일시정지' : '재생'}
              </Text>
            </Pressable>
            <Text style={styles.meta}>
              {frames.length > 0
                ? `스켈레톤 ${frames.length}프레임`
                : '스켈레톤 없음'}
              {phases.length > 0 ? ` · 구간 ${phases.length}` : ''}
              {skeletonOnly ? ' · 영상 없음' : ''}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#11131A',
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    minWidth: 56,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  stageArea: {
    flex: 1,
    position: 'relative',
  },
  stageWrap: {
    flex: 1,
    width: '100%',
  },
  stage: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  skeletonStage: {
    backgroundColor: '#161822',
  },
  phaseOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    zIndex: 3,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(17,19,26,0.45)',
  },
  hintOverlay: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    zIndex: 4,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  controlsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    paddingHorizontal: 20,
    paddingTop: 14,
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(17,19,26,0.42)',
  },
  controls: {
    paddingHorizontal: 20,
    paddingTop: 10,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#11131A',
  },
  rateBlock: {
    width: '100%',
    gap: 6,
  },
  rateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rateLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '700',
  },
  rateValue: {
    color: '#C9B8FF',
    fontSize: 13,
    fontWeight: '800',
  },
  rateTrackHit: {
    width: '100%',
    height: 28,
    justifyContent: 'center',
  },
  rateTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'visible',
    justifyContent: 'center',
  },
  rateFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: '#8971EA',
  },
  rateThumb: {
    position: 'absolute',
    top: -7,
    marginLeft: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#8971EA',
  },
  rateTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rateTick: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '600',
  },
  playBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(137,113,234,0.72)',
  },
  playBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  meta: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '600',
  },
  hint: {
    marginTop: 10,
    marginHorizontal: 20,
    textAlign: 'center',
    color: '#E5A85D',
    fontSize: 12,
    fontWeight: '600',
  },
  error: {
    marginTop: 32,
    marginHorizontal: 24,
    textAlign: 'center',
    color: '#FF8A80',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: { opacity: 0.85 },
});
