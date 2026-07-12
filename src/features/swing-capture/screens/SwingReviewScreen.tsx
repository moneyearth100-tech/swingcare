/**
 * 업로드 스윙 영상 재생 + LandmarkFrame 스켈레톤 오버레이.
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

import PhaseTimeline from '../components/PhaseTimeline';
import SkeletonOverlay, {
  createEmptyPackedPosePoints,
  packPosePoints,
} from '../components/SkeletonOverlay';
import type { LandmarkFrame, PhaseMarker } from '../lib/landmarkTypes';
import { segmentSwingPhases } from '../lib/phaseSegmentation';
import {
  createSwingVideoSignedUrl,
  fetchSwingPlaybackSession,
  nearestFrameIndex,
} from '../../../services/supabase/swingPlayback';

/** 슬로우~정상 배속 범위 */
const RATE_MIN = 0.25;
const RATE_MAX = 1;
const RATE_DEFAULT = 0.5;

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
  const { sessionId: rawId } = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<LandmarkFrame[]>([]);
  const [phases, setPhases] = useState<PhaseMarker[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);

  const pointsSV = useSharedValue(createEmptyPackedPosePoints());
  const framesRef = useRef<LandmarkFrame[]>([]);
  framesRef.current = frames;
  const playbackRateRef = useRef(RATE_DEFAULT);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 1 / 30;
    p.playbackRate = RATE_DEFAULT;
    p.preservesPitch = true;
  });

  const applyPlaybackRate = useCallback(
    (rate: number) => {
      const next = clampRate(rate);
      playbackRateRef.current = next;
      if (!player) {
        return;
      }
      try {
        if (player.playbackRate === next) {
          return;
        }
        player.playbackRate = next;
        player.preservesPitch = true;
      } catch (e) {
        console.warn('[SwingReview] playbackRate', e);
      }
    },
    [player],
  );

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
        if (!session.videoUrl) {
          setError('재생할 영상이 없어요');
          return;
        }
        const url = await createSwingVideoSignedUrl(session.videoUrl);
        if (cancelled) {
          return;
        }
        if (!url) {
          setError('영상 URL을 만들지 못했어요');
          return;
        }
        setFrames(session.frames);
        const resolvedPhases =
          session.phases.length > 0
            ? session.phases
            : session.frames.length > 0
              ? segmentSwingPhases(session.frames).phases
              : [];
        setPhases(resolvedPhases);
        setSignedUrl(url);
        if (session.frames.length === 0) {
          setHint('좌표 프레임이 없어 영상만 재생해요');
        } else if (resolvedPhases.length === 0) {
          setHint('구간(어드레스~피니시) 정보가 없어요');
        } else {
          setHint(null);
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
    };
  }, [sessionId]);

  useEffect(() => {
    if (!signedUrl || !player) {
      return;
    }
    try {
      player.replace(signedUrl);
      player.playbackRate = playbackRateRef.current;
      player.preservesPitch = true;
      player.play();
      setPlaying(true);
    } catch (e) {
      console.warn('[SwingReview] replace', e);
    }
  }, [signedUrl, player]);

  const applyFrameAtMs = useCallback(
    (timeMs: number) => {
      const list = framesRef.current;
      if (list.length === 0 || layout.width <= 0 || layout.height <= 0) {
        return;
      }
      const index = nearestFrameIndex(list, timeMs);
      if (index < 0) {
        return;
      }
      const frame = list[index];
      pointsSV.value = packPosePoints(frame.landmarks, {
        viewWidth: layout.width,
        viewHeight: layout.height,
        imageWidth: layout.width,
        imageHeight: layout.height,
      });
    },
    [layout.height, layout.width, pointsSV],
  );

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    applyFrameAtMs(currentTime * 1000);
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setPlaying(isPlaying);
  });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  const togglePlay = () => {
    if (!player) {
      return;
    }
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const stopPlayback = useCallback(() => {
    try {
      player.pause();
      player.replace(null);
    } catch (e) {
      console.warn('[SwingReview] stopPlayback', e);
    }
    setPlaying(false);
  }, [player]);

  const onClose = useCallback(() => {
    stopPlayback();
    router.back();
  }, [stopPlayback]);

  // 화면 이탈·언마운트 시 백그라운드 재생 방지
  useFocusEffect(
    useCallback(() => {
      return () => {
        stopPlayback();
      };
    }, [stopPlayback]),
  );

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

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

      {!loading && !error && signedUrl ? (
        <>
          <View style={styles.stageWrap}>
            <View style={styles.stage} onLayout={onLayout}>
              <VideoView
                style={StyleSheet.absoluteFill}
                player={player}
                contentFit="cover"
                nativeControls={false}
              />
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
                  <PhaseTimeline phases={phases} />
                </View>
              ) : null}
            </View>
          </View>

          {hint ? <Text style={styles.hint}>{hint}</Text> : null}

          <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
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
            </Text>
          </View>
        </>
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
    backgroundColor: '#8971EA',
  },
  playBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  meta: {
    color: 'rgba(255,255,255,0.65)',
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
