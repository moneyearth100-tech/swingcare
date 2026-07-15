/**
 * 캡처 화면 — 영상 업로드 탭 UI.
 *
 * iOS: 카메라로 찍은 영상은 Files(둘러보기)가 아니라 사진 앱에 있음.
 * → 기본은 expo-image-picker(사진 라이브러리), 보조는 File.pickFileAsync(파일 앱).
 */

import AnalysisFpsSlider from '@expo/ui/community/slider';
import { File, type PickSingleFileResult } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { createVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getSupabaseClient,
  isSupabaseConfigured,
} from '../../../services/supabase/client';
import { uploadSwingVideoAndCreateSession } from '../../../services/supabase/swingUpload';
import {
  analyzeVideoOnDevice,
  type OnDeviceAnalysisProgress,
} from '../lib/onDeviceVideoAnalysis';
import {
  DEFAULT_ANALYSIS_FPS,
  getAnalysisFps,
  MAX_ANALYSIS_FPS,
  MIN_ANALYSIS_FPS,
  normalizeAnalysisFps,
  setAnalysisFps as persistAnalysisFps,
} from '../lib/analysisFpsSetting';
import { useDominantHandSelection } from '../hooks/useDominantHandSelection';
import CameraAnglePicker, {
  type SelectableCameraAngle,
} from './CameraAnglePicker';
import DominantHandPicker from './DominantHandPicker';

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_MS = 30_000;
const DURATION_LOAD_TIMEOUT_MS = 10_000;
const STATUS_POLL_MS = 4000;

type RecentStatus = 'analyzing' | 'done' | 'error';

type RecentItem = {
  id: string;
  name: string;
  status: RecentStatus;
  meta: string;
};

type PickedVideo = {
  uri: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
};

type Props = {
  bottomInset: number;
};

function normalizeAnalysisProgress(
  value: unknown,
): OnDeviceAnalysisProgress | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<OnDeviceAnalysisProgress>;
  if (
    !Number.isFinite(candidate.percent) ||
    typeof candidate.status !== 'string' ||
    candidate.status.length === 0
  ) {
    return null;
  }
  return {
    percent: Math.round(Math.max(0, Math.min(100, candidate.percent as number))),
    status: candidate.status,
  };
}

function formatKstShort(iso: string = new Date().toISOString()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function metaForStatus(
  status: RecentStatus,
  overallScore?: number | null,
): string {
  const when = formatKstShort();
  if (status === 'analyzing') {
    return `${when} · 분석 중…`;
  }
  if (status === 'error') {
    return `${when} · 분석 실패`;
  }
  if (overallScore != null && Number.isFinite(overallScore)) {
    return `${when} · 분석 완료 · 종합 ${Math.round(overallScore)}점`;
  }
  return `${when} · 분석 완료`;
}

function isMissingNativeModuleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Cannot find native module') ||
    message.includes('ExpoImagePicker') ||
    message.includes('ExponentImagePicker')
  );
}

/**
 * Files 선택 결과에는 재생 시간이 없으므로 expo-video 메타데이터로 확인한다.
 * 길이를 확인하지 못한 영상은 30초 제한을 보장할 수 없어 업로드하지 않는다.
 */
async function readVideoDurationMs(uri: string): Promise<number | null> {
  let player: ReturnType<typeof createVideoPlayer> | null = null;
  try {
    player = createVideoPlayer({ uri });
    if (Number.isFinite(player.duration) && player.duration > 0) {
      return Math.round(player.duration * 1000);
    }

    return await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        subscription.remove();
        resolve(value);
      };
      const subscription = player!.addListener('sourceLoad', ({ duration }) => {
        finish(
          Number.isFinite(duration) && duration > 0
            ? Math.round(duration * 1000)
            : null,
        );
      });
      const timeout = setTimeout(() => {
        const duration = player?.duration ?? 0;
        finish(
          Number.isFinite(duration) && duration > 0
            ? Math.round(duration * 1000)
            : null,
        );
      }, DURATION_LOAD_TIMEOUT_MS);
    });
  } catch (error) {
    console.warn('[SwingUploadPanel] duration metadata', error);
    return null;
  } finally {
    player?.release();
  }
}

async function fetchRecentAnalysisState(sessionId: string): Promise<{
  status: RecentStatus;
  overallScore: number | null;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data: session, error: sessionError } = await supabase
    .from('swing_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return null;
  }

  if (session.status === 'pending' || session.status === 'processing') {
    return { status: 'analyzing', overallScore: null };
  }
  if (session.status === 'error') {
    return { status: 'error', overallScore: null };
  }
  if (session.status === 'done') {
    const { data: report } = await supabase
      .from('swing_reports')
      .select('overall_score')
      .eq('session_id', sessionId)
      .maybeSingle();
    const score =
      report?.overall_score != null ? Number(report.overall_score) : null;
    return { status: 'done', overallScore: score };
  }
  return null;
}

export default function SwingUploadPanel({ bottomInset }: Props) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [analysisFps, setAnalysisFps] = useState(DEFAULT_ANALYSIS_FPS);
  const [analysisProgress, setAnalysisProgress] =
    useState<OnDeviceAnalysisProgress | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [pendingVideo, setPendingVideo] = useState<PickedVideo | null>(null);
  const [uploadCameraAngle, setUploadCameraAngle] =
    useState<SelectableCameraAngle>('front');
  const { dominantHand, selectDominantHand, saving: savingHand } =
    useDominantHandSelection();
  const recentRef = useRef(recent);
  const maxPercentRef = useRef(0);
  recentRef.current = recent;
  const displayedProgress = normalizeAnalysisProgress(analysisProgress);

  useEffect(() => {
    void getAnalysisFps().then(setAnalysisFps);
  }, []);

  const handleAnalysisFpsChange = useCallback((value: number) => {
    const next = normalizeAnalysisFps(value);
    setAnalysisFps(next);
    void persistAnalysisFps(next).catch((error) => {
      console.warn('[SwingUploadPanel] analysis fps', error);
    });
  }, []);

  const updateAnalysisProgress = useCallback((value: unknown) => {
    const next = normalizeAnalysisProgress(value);
    if (!next) {
      return;
    }
    setAnalysisProgress((previous) => {
      const previousPercent =
        normalizeAnalysisProgress(previous)?.percent ?? 0;
      const percent = Math.max(
        maxPercentRef.current,
        previousPercent,
        next.percent,
      );
      maxPercentRef.current = percent;
      return { ...next, percent };
    });
  }, []);

  const refreshAnalyzingItems = useCallback(async () => {
    const analyzing = recentRef.current.filter(
      (item) => item.status === 'analyzing',
    );
    if (analyzing.length === 0) {
      return;
    }

    const updates = await Promise.all(
      analyzing.map(async (item) => {
        const next = await fetchRecentAnalysisState(item.id);
        return { id: item.id, next };
      }),
    );

    setRecent((prev) =>
      prev.map((item) => {
        const hit = updates.find((u) => u.id === item.id);
        if (!hit?.next || hit.next.status === 'analyzing') {
          return item;
        }
        return {
          ...item,
          status: hit.next.status,
          meta: metaForStatus(hit.next.status, hit.next.overallScore),
        };
      }),
    );

    if (updates.some((u) => u.next?.status === 'done')) {
      setStatus('분석 완료 · 리포트 탭에서 확인하세요');
    }
  }, []);

  useEffect(() => {
    const hasAnalyzing = recent.some((item) => item.status === 'analyzing');
    if (!hasAnalyzing) {
      return;
    }
    const id = setInterval(() => {
      void refreshAnalyzingItems();
    }, STATUS_POLL_MS);
    void refreshAnalyzingItems();
    return () => clearInterval(id);
  }, [recent, refreshAnalyzingItems]);

  const uploadPicked = async (
    picked: PickedVideo,
    cameraAngle: SelectableCameraAngle,
  ) => {
    if (
      picked.sizeBytes != null &&
      picked.sizeBytes > 0 &&
      picked.sizeBytes > MAX_BYTES
    ) {
      Alert.alert('용량 초과', '최대 200MB까지 업로드할 수 있어요.');
      return;
    }

    setUploading(true);
    setStatus('영상 길이 확인 중…');
    const durationMs =
      picked.durationMs ?? (await readVideoDurationMs(picked.uri));
    if (durationMs == null) {
      setUploading(false);
      setStatus(null);
      Alert.alert(
        '영상 길이 확인 실패',
        '영상 길이를 확인할 수 없어 업로드하지 않았어요. 다른 영상을 선택해 주세요.',
      );
      return;
    }
    if (durationMs > MAX_DURATION_MS) {
      setUploading(false);
      setStatus(null);
      Alert.alert(
        '영상이 너무 길어요',
        '스윙 영상은 30초 이내만 업로드할 수 있어요',
      );
      return;
    }

    try {
      setStatus(null);
      maxPercentRef.current = 0;
      updateAnalysisProgress({
        percent: 3,
        status: '프레임 추출 준비 중',
      });
      const analysis = await analyzeVideoOnDevice({
        uri: picked.uri,
        expectedDurationMs: durationMs,
        dominantHand,
        onProgress: (progress) => {
          updateAnalysisProgress(progress);
        },
      });

      updateAnalysisProgress({
        percent: 98,
        status: '영상과 리포트 업로드 중',
      });
      const uploaded = await uploadSwingVideoAndCreateSession({
        localUri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        sizeBytes: picked.sizeBytes,
        durationMs,
        cameraAngle,
        onDeviceAnalysis: analysis,
      });

      if (!uploaded.ok) {
        setAnalysisProgress(null);
        setStatus(null);
        Alert.alert('업로드 실패', uploaded.message);
        return;
      }

      updateAnalysisProgress({ percent: 100, status: '분석 완료' });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
      setStatus(
        `분석 완료 · ${analysis.frames.length}프레임 · 종합 ${Math.round(analysis.balanceScore.overallScore)}점`,
      );
      setPendingVideo(null);
      setRecent((prev) => [
        {
          id: uploaded.sessionId,
          name: picked.fileName,
          status: 'done',
          meta: metaForStatus('done', analysis.balanceScore.overallScore),
        },
        ...prev.slice(0, 4),
      ]);
    } catch (e) {
      setAnalysisProgress(null);
      setStatus(null);
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert(
        '영상 분석 실패',
        message.includes('다시 빌드')
          ? `${message}\niOS: npx expo run:ios\nAndroid: npx expo run:android`
          : message,
      );
    } finally {
      setAnalysisProgress(null);
      setUploading(false);
    }
  };

  const stagePickedVideo = (picked: PickedVideo) => {
    setPendingVideo(picked);
    setUploadCameraAngle('front');
    setStatus(null);
  };

  /** Files/둘러보기 — 파일 앱에 저장된 영상용 (Android 갤러리 폴백에도 사용) */
  const pickFromFiles = async () => {
    if (uploading) {
      return;
    }

    let picked: PickSingleFileResult;
    try {
      picked = await File.pickFileAsync({
        mimeTypes:
          Platform.OS === 'android' ? 'video/*' : ['video/*', 'video/mp4'],
        multipleFiles: false,
      });
    } catch (error) {
      console.warn('[SwingUploadPanel] pickFileAsync', error);
      Alert.alert(
        '파일 선택 실패',
        error instanceof Error ? error.message : '알 수 없는 오류',
      );
      return;
    }

    if (picked.canceled || !picked.result) {
      return;
    }

    const file = picked.result;
    await stagePickedVideo({
      uri: file.uri,
      fileName: file.name || `swing_${Date.now()}.mp4`,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size ?? null,
      durationMs: null,
    });
  };

  /** 사진 앱(카메라롤) — iOS에서 촬영 영상을 고르는 정상 경로 */
  const pickFromPhotos = async () => {
    if (uploading) {
      return;
    }

    try {
      if (
        typeof ImagePicker.requestMediaLibraryPermissionsAsync !== 'function' ||
        typeof ImagePicker.launchImageLibraryAsync !== 'function'
      ) {
        throw new Error('Cannot find native module ExponentImagePicker');
      }
    } catch (error) {
      console.warn('[SwingUploadPanel] image-picker unavailable', error);
      if (Platform.OS === 'android') {
        await pickFromFiles();
        return;
      }
      Alert.alert(
        '앱 재빌드 필요',
        '사진 선택을 쓰려면 Dev Client를 다시 빌드해야 합니다.\nnpx expo run:ios',
      );
      return;
    }

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          '권한 필요',
          '사진 앱에서 영상을 고르려면 사진 접근 권한이 필요합니다.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];
      const ext =
        asset.uri.toLowerCase().includes('.mov') ||
        asset.mimeType?.includes('quicktime')
          ? 'mov'
          : 'mp4';
      await stagePickedVideo({
        uri: asset.uri,
        fileName: asset.fileName ?? `swing_${Date.now()}.${ext}`,
        mimeType:
          asset.mimeType ?? (ext === 'mov' ? 'video/quicktime' : 'video/mp4'),
        sizeBytes: asset.fileSize ?? null,
        durationMs: asset.duration ?? null,
      });
    } catch (error) {
      if (isMissingNativeModuleError(error)) {
        if (Platform.OS === 'android') {
          await pickFromFiles();
          return;
        }
        Alert.alert(
          '앱 재빌드 필요',
          'ExponentImagePicker 네이티브 모듈이 없습니다.\nnpx expo run:ios 로 다시 빌드해 주세요.',
        );
        return;
      }
      console.warn('[SwingUploadPanel] photos pick', error);
      Alert.alert(
        '사진 선택 실패',
        error instanceof Error ? error.message : '알 수 없는 오류',
      );
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: bottomInset + 24 }]}>
      <View style={styles.dropzone}>
        <View style={styles.analysisBlock}>
          <View style={styles.analysisHeader}>
            <Text style={styles.analysisTitle}>분석 품질</Text>
            <Text style={styles.analysisValue}>{analysisFps}fps</Text>
          </View>
          <AnalysisFpsSlider
            accessibilityLabel="분석 품질"
            minimumValue={MIN_ANALYSIS_FPS}
            maximumValue={MAX_ANALYSIS_FPS}
            step={1}
            value={analysisFps}
            onValueChange={handleAnalysisFpsChange}
            minimumTrackTintColor="#2F6BFF"
            style={styles.analysisSlider}
          />
          <View style={styles.analysisRange}>
            <Text style={styles.analysisRangeText}>{MIN_ANALYSIS_FPS}fps</Text>
            <Text style={styles.analysisRangeText}>{MAX_ANALYSIS_FPS}fps</Text>
          </View>
        </View>
        <Text style={styles.dropTitle}>영상을 선택하세요</Text>
        <Text style={styles.dropMeta}>
          {
            '카메라로 찍은 영상은 「사진에서 선택」을 사용하세요.\n최대 30초 · 200MB'
          }
        </Text>

        {pendingVideo && !uploading ? (
          <View style={styles.angleBlock}>
            <Text style={styles.pendingName} numberOfLines={1}>
              {pendingVideo.fileName}
            </Text>
            <CameraAnglePicker
              value={uploadCameraAngle}
              onChange={setUploadCameraAngle}
              variant="compact"
              prompt="이 영상은 정면/측면 중 어느 쪽인가요?"
            />
            <DominantHandPicker
              value={dominantHand}
              onChange={selectDominantHand}
              variant="compact"
              disabled={uploading || savingHand}
              prompt="주손방향은 우타/좌타 중 어느 쪽인가요?"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="선택한 각도로 분석 시작"
              onPress={() => {
                void uploadPicked(pendingVideo, uploadCameraAngle);
              }}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryBtnText}>분석 시작</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPendingVideo(null)}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryBtnText}>다른 영상 고르기</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="사진에서 선택"
            disabled={uploading}
            onPress={() => {
              void pickFromPhotos();
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              (pressed || uploading) && styles.pressed,
            ]}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>사진에서 선택</Text>
            )}
          </Pressable>
        )}

        {displayedProgress ? (
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: displayedProgress.percent,
              text: `${displayedProgress.status} ${displayedProgress.percent}%`,
            }}
            style={styles.progressBlock}
          >
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${displayedProgress.percent}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {displayedProgress.status} {displayedProgress.percent}%
            </Text>
          </View>
        ) : status ? (
          <Text style={styles.status}>{status}</Text>
        ) : null}
      </View>

      <Text style={styles.subhead}>최근 불러온 영상</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>아직 업로드한 영상이 없어요</Text>
      ) : (
        recent.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.name} 재생`}
            onPress={() => {
              if (item.status === 'analyzing') {
                Alert.alert(
                  '분석 중',
                  '분석이 끝난 뒤 영상과 스켈레톤을 볼 수 있어요.',
                );
                return;
              }
              if (item.status === 'error') {
                Alert.alert('분석 실패', '이 영상은 재생 리뷰를 할 수 없어요.');
                return;
              }
              router.push(`/review/${item.id}`);
            }}
            style={({ pressed }) => [
              styles.fileItem,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.fileIcon}>
              <Text style={styles.fileIconText}>▶</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.fileMeta}>{item.meta}</Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FDFDFD',
    paddingTop: 8,
  },
  dropzone: {
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1.6,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    gap: 10,
  },
  analysisBlock: {
    alignSelf: 'stretch',
    marginBottom: 8,
  },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  analysisTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#232630',
  },
  analysisValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2F6BFF',
  },
  analysisSlider: { height: 40, marginTop: 4 },
  analysisRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  analysisRangeText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#9AA1B5',
  },
  dropTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#232630',
    textAlign: 'center',
  },
  dropMeta: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#7A8198',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 18,
  },
  angleBlock: {
    alignSelf: 'stretch',
    gap: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  pendingName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#4A5168',
    maxWidth: '100%',
  },
  primaryBtn: {
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: '#2D3142',
    minWidth: 180,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(35,38,48,0.12)',
    minWidth: 180,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#232630',
    fontSize: 13.5,
    fontWeight: '700',
  },
  pressed: { opacity: 0.85 },
  status: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#8971EA',
  },
  progressBlock: {
    alignSelf: 'stretch',
    marginTop: 8,
    gap: 7,
  },
  progressTrack: {
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(137,113,234,0.16)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#8971EA',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8971EA',
    textAlign: 'center',
  },
  subhead: {
    marginHorizontal: 24,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '800',
    color: '#232630',
  },
  empty: {
    marginHorizontal: 24,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#A7ADBD',
  },
  fileItem: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.72)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(63,191,143,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIconText: {
    color: '#3FBF8F',
    fontSize: 12,
    fontWeight: '800',
  },
  fileName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#232630',
  },
  fileMeta: {
    marginTop: 2,
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7A8198',
  },
});
