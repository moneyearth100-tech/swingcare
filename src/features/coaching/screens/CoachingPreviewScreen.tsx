/**
 * 코칭 클립 미리보기 — draft. 「이 구간이 맞나요?」→ 코치 선택.
 */

import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createCoachingClipSignedUrl,
  fetchCoachingRequest,
} from '../../../services/supabase/coaching';
import {
  fetchSwingPlaybackSession,
  nearestFrameIndex,
} from '../../../services/supabase/swingPlayback';
import { fetchSwingReportBySessionId } from '../../../services/supabase/swingReports';
import SkeletonOverlay, {
  createEmptyPackedPosePoints,
  packPosePoints,
} from '../../swing-capture/components/SkeletonOverlay';
import type { LandmarkFrame } from '../../swing-capture/lib/landmarkTypes';
import {
  DIAGNOSIS_TEMPLATES,
  PHASE_LABEL_KO,
  parseDiagnosisText,
} from '../../swing-capture/lib/scoring/diagnosisTemplates';

function resolveTag(issuePhase: string | null): string {
  if (!issuePhase) {
    return DIAGNOSIS_TEMPLATES.overall_good.tagLabel;
  }
  const label =
    PHASE_LABEL_KO[issuePhase as keyof typeof PHASE_LABEL_KO] ?? issuePhase;
  return `살펴볼 구간 · ${label}`;
}

export default function CoachingPreviewScreen() {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { requestId: raw } = useLocalSearchParams<{ requestId?: string }>();
  const requestId = Array.isArray(raw) ? raw[0] : raw;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnosisText, setDiagnosisText] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [patternId, setPatternId] = useState<string | null>(null);
  const [usesOriginalVideo, setUsesOriginalVideo] = useState(false);
  const [clipStartMs, setClipStartMs] = useState(0);
  const [frames, setFrames] = useState<LandmarkFrame[]>([]);
  const [mirrorSkeleton, setMirrorSkeleton] = useState(false);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);
  const [previewStageLayout, setPreviewStageLayout] = useState({
    width: 0,
    height: 0,
  });
  const [fullscreenStageLayout, setFullscreenStageLayout] = useState({
    width: 0,
    height: 0,
  });
  const pointsSV = useSharedValue(createEmptyPackedPosePoints());
  const stageLayout = fullscreenVisible
    ? fullscreenStageLayout
    : previewStageLayout;
  const fullscreenStageSize =
    window.width / window.height <= 9 / 16
      ? { width: window.width, height: window.width * (16 / 9) }
      : { width: window.height * (9 / 16), height: window.height };

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 1 / 30;
  });

  const load = useCallback(async () => {
    if (!requestId) {
      setError('요청 ID가 없어요');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const row = await fetchCoachingRequest(requestId);
    if (!row) {
      setError('요청을 찾을 수 없어요');
      setLoading(false);
      return;
    }
    if (row.status !== 'draft') {
      setError('이미 전송된 요청이에요');
      setLoading(false);
      return;
    }
    setDiagnosisText(row.diagnosis_summary);
    setPhase(row.issue_phase);
    setPatternId(row.diagnosis_pattern_id);
    setUsesOriginalVideo(row.clip_url?.startsWith('swing-uploads/') ?? false);
    setClipStartMs(row.clip_start_ms ?? 0);
    setFrames([]);
    setMirrorSkeleton(false);
    if (row.session_id) {
      const [report, session] = await Promise.all([
        fetchSwingReportBySessionId(row.session_id),
        fetchSwingPlaybackSession(row.session_id),
      ]);
      setDiagnosisText(report?.diagnosis_text ?? row.diagnosis_summary);
      if (session?.frames.length) {
        setFrames(session.frames);
        setMirrorSkeleton(session.captureMode === 'live');
      }
    }
    if (!row.clip_url) {
      setError('클립이 아직 준비되지 않았어요');
      setLoading(false);
      return;
    }
    const url = await createCoachingClipSignedUrl(row.clip_url);
    if (!url) {
      setError('클립 URL을 만들지 못했어요');
      setLoading(false);
      return;
    }
    setSignedUrl(url);
    setLoading(false);
  }, [requestId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void load();
    }, 0);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [load]);

  useEffect(() => {
    if (!signedUrl || !player) {
      return;
    }
    try {
      player.replace(signedUrl);
      player.play();
    } catch (e) {
      console.warn('[CoachingPreview] replace', e);
    }
  }, [signedUrl, player]);

  const applySkeletonFrame = useCallback(
    (videoTimeMs: number) => {
      if (
        frames.length === 0 ||
        stageLayout.width <= 0 ||
        stageLayout.height <= 0
      ) {
        return;
      }
      const frameIndex = nearestFrameIndex(
        frames,
        videoTimeMs + (usesOriginalVideo ? 0 : clipStartMs),
      );
      if (frameIndex < 0) {
        return;
      }
      const frame = frames[frameIndex];
      const landmarks = mirrorSkeleton
        ? frame.landmarks.map((point) => ({ ...point, x: 1 - point.x }))
        : frame.landmarks;
      pointsSV.set(
        packPosePoints(landmarks, {
          viewWidth: stageLayout.width,
          viewHeight: stageLayout.height,
          imageWidth: stageLayout.width,
          imageHeight: stageLayout.height,
        }),
      );
    },
    [
      clipStartMs,
      frames,
      mirrorSkeleton,
      pointsSV,
      stageLayout.height,
      stageLayout.width,
      usesOriginalVideo,
    ],
  );

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    applySkeletonFrame(currentTime * 1000);
  });

  useEffect(() => {
    applySkeletonFrame(0);
  }, [applySkeletonFrame]);

  const onPreviewStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewStageLayout({ width, height });
  }, []);

  const onFullscreenStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFullscreenStageLayout({ width, height });
  }, []);

  const stopPlayback = useCallback(() => {
    try {
      player.pause();
    } catch (e) {
      console.warn('[CoachingPreview] pause', e);
    }
  }, [player]);

  const parsedDiagnosis = parseDiagnosisText(diagnosisText);

  // 화면 떠날 때도 재생 중지 (제스처 뒤로가기 포함)
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // unmount
      }
    };
  }, [player]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable
          onPress={() => {
            stopPlayback();
            router.back();
          }}
          style={styles.backBtn}
          accessibilityRole="button"
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>클립 미리보기</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#8971EA" />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error && signedUrl ? (
        <View style={styles.content}>
          <Text
            style={[
              styles.question,
              usesOriginalVideo && styles.questionStandalone,
            ]}
          >
            {usesOriginalVideo ? '전체 영상을 확인해 주세요' : '이 구간이 맞나요?'}
          </Text>
          {!usesOriginalVideo ? (
            <Text style={styles.meta}>
              {`${phase ? `구간 · ${phase}` : '문제 구간 클립'} · 약 8초`}
            </Text>
          ) : null}
          <View style={styles.stageWrap}>
            <View style={styles.stage} onLayout={onPreviewStageLayout}>
              {!fullscreenVisible ? (
                <VideoView
                  style={StyleSheet.absoluteFill}
                  player={player}
                  contentFit="contain"
                  nativeControls
                />
              ) : null}
              {!fullscreenVisible &&
              frames.length > 0 &&
              stageLayout.width > 0 &&
              stageLayout.height > 0 ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <SkeletonOverlay
                    pointsSV={pointsSV}
                    width={stageLayout.width}
                    height={stageLayout.height}
                  />
                </View>
              ) : null}
              {!fullscreenVisible ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="전체 화면으로 전환"
                  hitSlop={8}
                  onPress={() => setFullscreenVisible(true)}
                  style={styles.previewFullscreenButton}
                >
                  <SymbolView
                    name={{
                      ios: 'arrow.up.left.and.arrow.down.right',
                      android: 'open_in_full',
                      web: 'open_in_full',
                    }}
                    size={18}
                    tintColor="#fff"
                    weight="semibold"
                    fallback={
                      <Text style={styles.previewFullscreenFallback}>⛶</Text>
                    }
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView
            style={styles.actionsScroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            showsVerticalScrollIndicator={false}
          >
            {diagnosisText ? (
              <View style={styles.diagnosisBox}>
                <Text style={styles.diagnosisTag}>{resolveTag(phase)}</Text>
                {parsedDiagnosis.legacy || !parsedDiagnosis.summary ? (
                  <Text style={styles.diagnosisBody}>{diagnosisText}</Text>
                ) : (
                  <View style={styles.diagnosisStructured}>
                    <Text style={styles.diagnosisBody}>
                      {parsedDiagnosis.summary}
                    </Text>
                    {parsedDiagnosis.facts.length > 0 ? (
                      <View style={styles.diagnosisSection}>
                        <Text style={styles.diagnosisHeading}>
                          이번 스윙에서 눈에 띈 점
                        </Text>
                        {parsedDiagnosis.facts.map((fact) => (
                          <Text key={fact} style={styles.diagnosisLine}>
                            · {fact}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {parsedDiagnosis.next ? (
                      <View style={styles.diagnosisSection}>
                        <Text style={styles.diagnosisHeading}>다음</Text>
                        <Text style={styles.diagnosisLine}>
                          {parsedDiagnosis.next.replace(/^다음\s*:\s*/, '')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                stopPlayback();
                router.push({
                  pathname: '/coaching/select-coach',
                  params: {
                    requestId: requestId!,
                    patternId: patternId ?? '',
                  },
                });
              }}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>분석을 요청할 코치 선택하기</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                stopPlayback();
                router.back();
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>다시 고를게요</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        visible={fullscreenVisible}
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setFullscreenVisible(false)}
      >
        <View style={styles.fullscreenRoot}>
          <View
            style={[styles.fullscreenStage, fullscreenStageSize]}
            onLayout={onFullscreenStageLayout}
          >
            <VideoView
              style={StyleSheet.absoluteFill}
              player={player}
              contentFit="contain"
              nativeControls
            />
            {frames.length > 0 &&
            stageLayout.width > 0 &&
            stageLayout.height > 0 ? (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <SkeletonOverlay
                  pointsSV={pointsSV}
                  width={stageLayout.width}
                  height={stageLayout.height}
                />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="전체 화면 닫기"
              onPress={() => setFullscreenVisible(false)}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="전체화면 닫기"
            hitSlop={12}
            onPress={() => setFullscreenVisible(false)}
            style={[styles.fullscreenClose, { top: insets.top + 12 }]}
          >
            <Text style={styles.fullscreenCloseText}>닫기</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#11131A', paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { color: '#fff', fontSize: 28, fontWeight: '300' },
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  content: { flex: 1 },
  actionsScroll: { flex: 1 },
  question: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  questionStandalone: {
    marginBottom: 18,
  },
  meta: { color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginBottom: 12 },
  stageWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    width: '100%',
    maxWidth: 212.4,
    aspectRatio: 9 / 16,
    maxHeight: 378,
    alignSelf: 'center',
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden',
  },
  previewFullscreenButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(17, 19, 26, 0.78)',
  },
  previewFullscreenFallback: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 22,
  },
  fullscreenRoot: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenStage: {
    backgroundColor: '#000',
  },
  fullscreenClose: {
    position: 'absolute',
    right: 16,
    zIndex: 2,
    minWidth: 52,
    height: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(17, 19, 26, 0.78)',
  },
  fullscreenCloseText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  diagnosisBox: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 154, 168, 0.18)',
    gap: 4,
  },
  diagnosisTag: {
    color: '#FF9AAF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  diagnosisStructured: {
    gap: 6,
  },
  diagnosisBody: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  diagnosisSection: {
    gap: 1,
  },
  diagnosisHeading: {
    color: '#FF9AAF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  diagnosisLine: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 16,
  },
  cta: {
    marginTop: 18,
    backgroundColor: '#8971EA',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondary: { marginTop: 12, alignItems: 'center', padding: 10 },
  secondaryText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700' },
  error: {
    marginTop: 24,
    color: '#FF8A80',
    textAlign: 'center',
    fontWeight: '600',
  },
});
