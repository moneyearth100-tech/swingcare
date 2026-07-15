/**
 * 스윙 리포트 상세 — diagnosis-box + 밸런스 지수 (목업 #detail-report).
 *
 * NOTE: 골프존 섹션(비거리/구질/방향편차/스핀)은 FEATURE_FLAGS.REPORT_GOLFZON_SECTION
 * 제휴 확정 전 비노출 유지 (마스터스펙 11장).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  DIAGNOSIS_TEMPLATES,
  parseDiagnosisText,
  PHASE_LABEL_KO,
} from '../lib/scoring/diagnosisTemplates';
import {
  BALANCE_SCORE_JOINTS,
  JOINT_LABEL_KO,
  SCORE_BAND_CAUTION,
  type BalanceScoreJoint,
} from '../lib/scoring/balanceScoreConstants';
import {
  isWeightShiftTowardTarget,
  movementDeltaBandLabel,
  trailWristSide,
} from '../lib/scoring/movementMetrics';
import {
  cameraAngleLabelKo,
  shouldShowReferenceBadge,
} from '../lib/cameraAngleReliability';
import type { CameraAngle } from '../lib/landmarkTypes';
import { extractCoachingClip } from '../../../services/supabase/coaching';
import {
  fetchSwingReportBySessionId,
  type SwingReportRow,
} from '../../../services/supabase/swingReports';
import {
  fetchSwingSessionVideoMeta,
} from '../../../services/supabase/swingPlayback';
import { attachVideoToSwingSession } from '../../../services/supabase/swingUpload';
import SwingVideoThumb from '../components/SwingVideoThumb';

function ReferenceBadge() {
  return (
    <View style={styles.refBadge}>
      <Text style={styles.refBadgeText}>참고용</Text>
    </View>
  );
}

async function pickCoachingVideo(): Promise<{
  uri: string;
  fileName: string;
  mimeType: string | null;
} | null> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        '권한 필요',
        '코칭용 영상을 고르려면 사진 접근 권한이 필요합니다.',
      );
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) {
      return null;
    }
    const asset = result.assets[0];
    const ext =
      asset.uri.toLowerCase().includes('.mov') ||
      asset.mimeType?.includes('quicktime')
        ? 'mov'
        : 'mp4';
    return {
      uri: asset.uri,
      fileName: asset.fileName ?? `swing_${Date.now()}.${ext}`,
      mimeType:
        asset.mimeType ?? (ext === 'mov' ? 'video/quicktime' : 'video/mp4'),
    };
  } catch (error) {
    Alert.alert(
      '영상 선택 실패',
      error instanceof Error ? error.message : '알 수 없는 오류',
    );
    return null;
  }
}

function jointLabel(key: BalanceScoreJoint | string): string {
  if (key in JOINT_LABEL_KO) {
    return JOINT_LABEL_KO[key as BalanceScoreJoint];
  }
  return key;
}

/** v1(3키)·v2(5키) 모두 — 값이 있는 관절만 순서대로 */
function orderedJointEntries(
  scores: SwingReportRow['joint_scores'],
): { key: BalanceScoreJoint; value: number }[] {
  const entries: { key: BalanceScoreJoint; value: number }[] = [];
  for (const key of BALANCE_SCORE_JOINTS) {
    const value = scores?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      entries.push({ key, value });
    }
  }
  // v1에만 있고 목록에 없는 키는 없음 — 혹시 모를 추가 키
  if (scores) {
    for (const [key, value] of Object.entries(scores)) {
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        !BALANCE_SCORE_JOINTS.includes(key as BalanceScoreJoint)
      ) {
        entries.push({ key: key as BalanceScoreJoint, value });
      }
    }
  }
  return entries;
}

function formatDelta(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(3);
}

function formatDeg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1)}°`;
}

function resolveTag(report: SwingReportRow): string {
  if (!report.issue_phase) {
    return DIAGNOSIS_TEMPLATES.overall_good.tagLabel;
  }
  const label =
    PHASE_LABEL_KO[report.issue_phase as keyof typeof PHASE_LABEL_KO] ??
    report.issue_phase;
  return `살펴볼 구간 · ${label}`;
}

export default function SwingReportDetailScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId =
    typeof params.sessionId === 'string' ? params.sessionId : null;

  const [report, setReport] = useState<SwingReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPlayableVideo, setHasPlayableVideo] = useState(false);
  const [hasReviewFrames, setHasReviewFrames] = useState(false);
  const [storageVideoUrl, setStorageVideoUrl] = useState<string | null>(null);
  const [storageThumbnailUrl, setStorageThumbnailUrl] = useState<string | null>(
    null,
  );
  const [videoLabel, setVideoLabel] = useState('스윙 영상');
  const [videoMetaLine, setVideoMetaLine] = useState(
    '탭하여 재생 · 스켈레톤 함께 표시',
  );
  const [cameraAngle, setCameraAngle] = useState<CameraAngle | null>(null);
  const [extracting, setExtracting] = useState(false);

  const dominantHand = profile?.dominant_hand ?? null;
  const trailSide = trailWristSide(dominantHand);

  const load = useCallback(async () => {
    if (!sessionId) {
      setError('세션 ID가 없습니다.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [row, media] = await Promise.all([
      fetchSwingReportBySessionId(sessionId),
      fetchSwingSessionVideoMeta(sessionId),
    ]);
    if (!row) {
      setError('리포트를 불러오지 못했습니다.');
      setReport(null);
      setHasPlayableVideo(false);
      setHasReviewFrames(false);
      setStorageVideoUrl(null);
      setStorageThumbnailUrl(null);
      setCameraAngle(null);
    } else {
      setReport(row);
      const path = media?.videoUrl ?? null;
      const thumb = media?.thumbnailUrl ?? null;
      setStorageVideoUrl(path);
      setStorageThumbnailUrl(thumb);
      setHasPlayableVideo(Boolean(path));
      setHasReviewFrames(Boolean(media?.hasFrames));
      setCameraAngle(media?.cameraAngle ?? null);
      if (media?.captureMode === 'upload') {
        setVideoLabel('업로드 스윙 영상');
        setVideoMetaLine('탭하여 재생 · 스켈레톤 함께 표시');
      } else if (media?.captureMode === 'live') {
        if (path) {
          setVideoLabel('실시간 스윙 영상');
          setVideoMetaLine('탭하여 재생 · 스켈레톤 함께 표시');
        } else {
          setVideoLabel('실시간 스윙 스켈레톤');
          setVideoMetaLine('탭하여 재생 · 저장된 스켈레톤 표시');
        }
      } else {
        setVideoLabel(path ? '스윙 영상' : '스윙 스켈레톤');
        setVideoMetaLine(
          path
            ? '탭하여 재생 · 스켈레톤 함께 표시'
            : '탭하여 재생 · 저장된 스켈레톤 표시',
        );
      }
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cockingRows = useMemo(() => {
    const metrics = report?.movement_metrics;
    if (!metrics) {
      return [];
    }
    const right = {
      key: 'right' as const,
      label: '오른쪽',
      value: metrics.rightWristCockingDeg,
    };
    const left = {
      key: 'left' as const,
      label: '왼쪽',
      value: metrics.leftWristCockingDeg,
    };
    if (trailSide === 'right') {
      return [
        { ...right, primary: true, label: '오른쪽 (트레일)' },
        { ...left, primary: false },
      ];
    }
    if (trailSide === 'left') {
      return [
        { ...left, primary: true, label: '왼쪽 (트레일)' },
        { ...right, primary: false },
      ];
    }
    return [
      { ...right, primary: true },
      { ...left, primary: false },
    ];
  }, [report?.movement_metrics, trailSide]);

  const showWeightShiftRef = shouldShowReferenceBadge(
    'weightShift',
    cameraAngle,
  );
  const showJointRef = shouldShowReferenceBadge('jointAngles', cameraAngle);
  const showCockingRef = shouldShowReferenceBadge('wristCocking', cameraAngle);

  const weightShiftTowardTarget = useMemo(() => {
    const metrics = report?.movement_metrics;
    if (!metrics || !dominantHand) {
      return null;
    }
    if (metrics.weightShiftTowardTarget != null) {
      return metrics.weightShiftTowardTarget;
    }
    if (
      metrics.weightShiftSigned != null &&
      Number.isFinite(metrics.weightShiftSigned)
    ) {
      return isWeightShiftTowardTarget(
        metrics.weightShiftSigned,
        dominantHand,
      );
    }
    return null;
  }, [dominantHand, report?.movement_metrics]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/capture');
            }
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>스윙 리포트</Text>
        <View style={styles.backSpacer} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : error || !report ? (
        <Text style={styles.error}>{error ?? '데이터 없음'}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 28 },
          ]}
        >
          {(hasPlayableVideo || hasReviewFrames) && sessionId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${videoLabel} 재생`}
              onPress={() => router.push(`/review/${sessionId}`)}
              style={({ pressed }) => [
                styles.videoCard,
                pressed && styles.pressed,
              ]}
            >
              {hasPlayableVideo ? (
                <SwingVideoThumb
                  videoUrl={storageVideoUrl}
                  thumbnailUrl={storageThumbnailUrl}
                />
              ) : (
                <View style={styles.videoThumb}>
                  <Text style={styles.videoPlay}>▶</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.videoTitle}>{videoLabel}</Text>
                <Text style={styles.videoMeta}>{videoMetaLine}</Text>
              </View>
            </Pressable>
          ) : (
            <View style={[styles.videoCard, styles.videoCardMuted]}>
              <View style={styles.videoThumb}>
                <Text style={styles.videoPlay}>—</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.videoTitle}>리뷰 데이터 없음</Text>
                <Text style={styles.videoMeta}>
                  재생할 영상이나 스켈레톤 좌표가 없어요
                </Text>
              </View>
            </View>
          )}

          <View style={styles.diagnosisBox}>
            <Text style={styles.diagnosisTag}>{resolveTag(report)}</Text>
            {(() => {
              const parsed = parseDiagnosisText(report.diagnosis_text);
              if (parsed.legacy || !parsed.summary) {
                return (
                  <Text style={styles.diagnosisBody}>
                    {report.diagnosis_text ?? '인사이트 문구가 없습니다.'}
                  </Text>
                );
              }
              return (
                <View style={styles.diagnosisStructured}>
                  <Text style={styles.diagnosisBody}>{parsed.summary}</Text>
                  {parsed.facts.length > 0 ? (
                    <View style={styles.factBlock}>
                      <Text style={styles.factHeading}>이번 스윙에서 눈에 띈 점</Text>
                      {parsed.facts.map((fact) => (
                        <Text key={fact} style={styles.factLine}>
                          · {fact}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {parsed.next ? (
                    <View style={styles.factBlock}>
                      <Text style={styles.factHeading}>다음</Text>
                      <Text style={styles.nextLine}>
                        {parsed.next.replace(/^다음\s*:\s*/, '')}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })()}
          </View>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>
                스윙 밸런스 지수 상세 · 종합 {report.overall_score}
              </Text>
              {showJointRef ? <ReferenceBadge /> : null}
            </View>
            {cameraAngle ? (
              <Text style={styles.angleMeta}>
                촬영 각도 · {cameraAngleLabelKo(cameraAngle)}
              </Text>
            ) : null}
            {orderedJointEntries(report.joint_scores).map(({ key, value }) => {
              const warn = value < SCORE_BAND_CAUTION;
              return (
                <View key={key} style={styles.loadBar}>
                  <View style={styles.loadBarTop}>
                    <Text style={styles.loadBarLabel}>
                      {jointLabel(key)}
                      {warn ? ' · 주의' : ''}
                    </Text>
                    <Text style={styles.loadBarValue}>{value}</Text>
                  </View>
                  <View style={styles.loadTrack}>
                    <View
                      style={[
                        styles.loadFill,
                        warn && styles.loadFillWarn,
                        { width: `${Math.max(4, Math.min(100, value))}%` },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>

          {report.movement_metrics ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>이동 지표</Text>
              <View style={styles.metricRow}>
                <View style={styles.metricLabelRow}>
                  <Text style={styles.metricLabel}>체중 이동량</Text>
                  {showWeightShiftRef ? <ReferenceBadge /> : null}
                </View>
                <View style={styles.metricRight}>
                  <Text style={styles.metricValue}>
                    {formatDelta(report.movement_metrics.weightShiftDelta)}
                  </Text>
                  {movementDeltaBandLabel(
                    report.movement_metrics.weightShiftDelta,
                  ) ? (
                    <Text style={styles.metricBand}>
                      {movementDeltaBandLabel(
                        report.movement_metrics.weightShiftDelta,
                      )}
                    </Text>
                  ) : null}
                  {weightShiftTowardTarget != null ? (
                    <Text style={styles.metricBand}>
                      {weightShiftTowardTarget ? '타겟 방향' : '타겟 반대'}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>머리 이동량</Text>
                <View style={styles.metricRight}>
                  <Text style={styles.metricValue}>
                    {formatDelta(report.movement_metrics.headRiseDelta)}
                  </Text>
                  {movementDeltaBandLabel(
                    report.movement_metrics.headRiseDelta,
                  ) ? (
                    <Text style={styles.metricBand}>
                      {movementDeltaBandLabel(
                        report.movement_metrics.headRiseDelta,
                      )}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.cockingHead}>
                <Text style={styles.metricLabel}>손목 코킹 (탑)</Text>
                {showCockingRef ? <ReferenceBadge /> : null}
              </View>
              <Text style={styles.cockingHint}>
                촬영 각도(
                {cameraAngleLabelKo(cameraAngle ?? 'front')})에 따라 수치가
                달라질 수 있어요
              </Text>
              {cockingRows.map((row) => (
                <View key={row.key} style={styles.metricRow}>
                  <Text
                    style={
                      row.primary
                        ? styles.metricLabel
                        : styles.metricLabelMuted
                    }
                  >
                    {row.label}
                  </Text>
                  <Text
                    style={
                      row.primary
                        ? styles.metricValuePrimary
                        : styles.metricValueMuted
                    }
                  >
                    {formatDeg(row.value)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={extracting || !sessionId}
            onPress={() => {
              if (!sessionId || extracting) {
                return;
              }
              void (async () => {
                setExtracting(true);
                try {
                  let ready = hasPlayableVideo;
                  if (!ready) {
                    const picked = await pickCoachingVideo();
                    if (!picked) {
                      return;
                    }
                    const attached = await attachVideoToSwingSession({
                      sessionId,
                      localUri: picked.uri,
                      fileName: picked.fileName,
                      mimeType: picked.mimeType,
                    });
                    if (!attached.ok) {
                      Alert.alert('영상 첨부 실패', attached.message);
                      return;
                    }
                    setHasPlayableVideo(true);
                    setStorageVideoUrl(attached.videoUrl);
                    setVideoLabel('실시간 스윙 영상');
                    ready = true;
                  }

                  const result = await extractCoachingClip(sessionId);
                  if (!result.ok || !result.requestId) {
                    Alert.alert(
                      '코칭 요청',
                      result.message ?? '클립을 만들지 못했어요',
                    );
                    return;
                  }
                  router.push(`/coaching/preview/${result.requestId}`);
                } finally {
                  setExtracting(false);
                }
              })();
            }}
            style={[styles.coachCta, extracting && styles.coachCtaDisabled]}
          >
            {extracting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.coachCtaText}>코치에게 보내기</Text>
            )}
          </Pressable>
          {!hasPlayableVideo ? (
            <Text style={styles.coachHint}>
              실시간 촬영은 코칭용 스윙 영상을 한 번 선택해요
              {Platform.OS === 'ios' ? ' (사진 앱)' : ''}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontSize: 28,
    fontWeight: '500',
    color: '#232630',
  },
  backSpacer: { width: 36 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#1A2333',
  },
  scroll: {
    paddingHorizontal: 20,
    gap: 14,
  },
  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#1A1D27',
  },
  videoCardMuted: {
    backgroundColor: '#2A303C',
  },
  pressed: { opacity: 0.88 },
  videoThumb: {
    width: 56,
    height: 72,
    borderRadius: 12,
    backgroundColor: 'rgba(137,113,234,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlay: {
    color: '#C9B8FF',
    fontSize: 18,
    fontWeight: '800',
  },
  videoTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  videoMeta: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '600',
  },
  error: {
    marginTop: 40,
    textAlign: 'center',
    color: '#7A8198',
    fontWeight: '600',
  },
  diagnosisBox: {
    marginTop: 4,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 154, 168, 0.18)',
    gap: 8,
  },
  diagnosisTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E85A7A',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  diagnosisBody: {
    fontSize: 13,
    fontWeight: '600',
    color: '#232630',
    lineHeight: 20,
  },
  diagnosisStructured: {
    gap: 10,
  },
  factBlock: {
    gap: 4,
    paddingTop: 2,
  },
  factHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E85A7A',
    marginBottom: 2,
  },
  factLine: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#3A4254',
    lineHeight: 18,
  },
  nextLine: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#232630',
    lineHeight: 18,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#232630',
    flexShrink: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  angleMeta: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7A8198',
    marginTop: -6,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  loadBar: { gap: 7 },
  loadBarTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loadBarLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#232630',
  },
  loadBarValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#232630',
  },
  loadTrack: {
    height: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(122,129,152,0.14)',
    overflow: 'hidden',
  },
  loadFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#2F6BFF',
  },
  loadFillWarn: {
    backgroundColor: '#FF758C',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metricLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#232630',
  },
  metricLabelMuted: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
  },
  metricRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#232630',
    fontVariant: ['tabular-nums'],
  },
  metricValuePrimary: {
    fontSize: 18,
    fontWeight: '800',
    color: '#232630',
    fontVariant: ['tabular-nums'],
  },
  metricValueMuted: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7A8198',
    fontVariant: ['tabular-nums'],
  },
  metricBand: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7A8198',
  },
  cockingHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  refBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(122,129,152,0.14)',
  },
  refBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5A6478',
  },
  cockingHint: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 16,
    marginTop: -4,
  },
  coachCta: {
    marginTop: 8,
    marginBottom: 8,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8971EA',
  },
  coachCtaDisabled: {
    backgroundColor: '#A7ADBD',
  },
  coachCtaText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  coachHint: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
    marginBottom: 8,
  },
});
