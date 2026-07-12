/**
 * 스윙 리포트 상세 — diagnosis-box + 밸런스 지수 (목업 #detail-report).
 *
 * NOTE: 골프존 섹션(비거리/구질/방향편차/스핀)은 FEATURE_FLAGS.REPORT_GOLFZON_SECTION
 * 제휴 확정 전 비노출 유지 (마스터스펙 11장).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import {
  DIAGNOSIS_TEMPLATES,
} from '../lib/scoring/diagnosisTemplates';
import { extractCoachingClip } from '../../../services/supabase/coaching';
import {
  fetchSwingReportBySessionId,
  type SwingReportRow,
} from '../../../services/supabase/swingReports';
import { fetchSwingSessionVideoMeta } from '../../../services/supabase/swingPlayback';
import { attachVideoToSwingSession } from '../../../services/supabase/swingUpload';

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

function jointLabel(key: string): string {
  if (key === 'lower_back') return '허리';
  if (key === 'wrist') return '손목';
  if (key === 'knee') return '무릎';
  return key;
}

function resolveTag(report: SwingReportRow): string {
  if (!report.issue_phase) {
    return DIAGNOSIS_TEMPLATES.overall_good.tagLabel;
  }
  const phaseKo: Record<string, string> = {
    address: '어드레스',
    toe_up: '토우업',
    mid_backswing: '백스윙중',
    top: '탑',
    mid_downswing: '다운스윙 초반',
    impact: '임팩트',
    mid_follow_through: '팔로우중',
    finish: '피니시',
  };
  const label = phaseKo[report.issue_phase] ?? report.issue_phase;
  return `문제 구간 · ${label}`;
}

export default function SwingReportDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId =
    typeof params.sessionId === 'string' ? params.sessionId : null;

  const [report, setReport] = useState<SwingReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPlayableVideo, setHasPlayableVideo] = useState(false);
  const [videoLabel, setVideoLabel] = useState('스윙 영상');
  const [extracting, setExtracting] = useState(false);

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
    } else {
      setReport(row);
      setHasPlayableVideo(Boolean(media?.videoUrl));
      if (media?.captureMode === 'upload') {
        setVideoLabel('업로드 스윙 영상');
      } else if (media?.captureMode === 'live') {
        setVideoLabel(
          media?.videoUrl ? '실시간 스윙 영상' : '실시간 촬영 · 코칭 시 영상 첨부',
        );
      } else {
        setVideoLabel('스윙 영상');
      }
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

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
          {hasPlayableVideo && sessionId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${videoLabel} 재생`}
              onPress={() => router.push(`/review/${sessionId}`)}
              style={({ pressed }) => [
                styles.videoCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.videoThumb}>
                <Text style={styles.videoPlay}>▶</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.videoTitle}>{videoLabel}</Text>
                <Text style={styles.videoMeta}>
                  탭하여 재생 · 스켈레톤 함께 표시
                </Text>
              </View>
            </Pressable>
          ) : (
            <View style={[styles.videoCard, styles.videoCardMuted]}>
              <View style={styles.videoThumb}>
                <Text style={styles.videoPlay}>＋</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.videoTitle}>{videoLabel}</Text>
                <Text style={styles.videoMeta}>
                  코치에게 보내기 시 같은 스윙 영상을 선택해요
                </Text>
              </View>
            </View>
          )}

          <View style={styles.diagnosisBox}>
            <Text style={styles.diagnosisTag}>{resolveTag(report)}</Text>
            <Text style={styles.diagnosisBody}>
              {report.diagnosis_text ?? '인사이트 문구가 없습니다.'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              스윙 밸런스 지수 상세 · 종합 {report.overall_score}
            </Text>
            {(['lower_back', 'wrist', 'knee'] as const).map((key) => {
              const value = report.joint_scores[key];
              const warn = value < 50;
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

          {report.recommended_drill_id ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>추천 드릴</Text>
              <Text style={styles.drillId}>{report.recommended_drill_id}</Text>
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
  drillId: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5A6478',
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
