/**
 * 캡처 화면 — 영상 업로드 탭 UI.
 *
 * iOS: 카메라로 찍은 영상은 Files(둘러보기)가 아니라 사진 앱에 있음.
 * → 기본은 expo-image-picker(사진 라이브러리), 보조는 File.pickFileAsync(파일 앱).
 */

import { File, type PickSingleFileResult } from 'expo-file-system';
import { router } from 'expo-router';
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

const MAX_BYTES = 200 * 1024 * 1024;
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
};

type Props = {
  bottomInset: number;
};

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
    message.includes('ExponentImagePicker') ||
    message.includes('undefined is not a function')
  );
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
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const recentRef = useRef(recent);
  recentRef.current = recent;

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

  const uploadPicked = async (picked: PickedVideo) => {
    if (
      picked.sizeBytes != null &&
      picked.sizeBytes > 0 &&
      picked.sizeBytes > MAX_BYTES
    ) {
      Alert.alert('용량 초과', '최대 200MB까지 업로드할 수 있어요.');
      return;
    }

    setUploading(true);
    setStatus('업로드 중…');

    try {
      const uploaded = await uploadSwingVideoAndCreateSession({
        localUri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        sizeBytes: picked.sizeBytes,
      });

      if (!uploaded.ok) {
        setStatus(null);
        Alert.alert('업로드 실패', uploaded.message);
        return;
      }

      setStatus('업로드 완료 · 분석 대기');
      setRecent((prev) => [
        {
          id: uploaded.sessionId,
          name: picked.fileName,
          status: 'analyzing',
          meta: metaForStatus('analyzing'),
        },
        ...prev.slice(0, 4),
      ]);
      // Android: 완료 Alert가 방해되어 생략 (상태 텍스트·최근 목록으로 충분)
      if (Platform.OS !== 'android') {
        Alert.alert(
          '업로드 완료',
          '영상이 등록됐어요. 분석이 끝나면 이 목록과 리포트 탭에 반영됩니다.',
        );
      }
    } catch (e) {
      setStatus(null);
      Alert.alert(
        '업로드 실패',
        e instanceof Error ? e.message : '알 수 없는 오류',
      );
    } finally {
      setUploading(false);
    }
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
    await uploadPicked({
      uri: file.uri,
      fileName: file.name || `swing_${Date.now()}.mp4`,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size ?? null,
    });
  };

  /** 사진 앱(카메라롤) — iOS에서 촬영 영상을 고르는 정상 경로 */
  const pickFromPhotos = async () => {
    if (uploading) {
      return;
    }

    let ImagePicker: typeof import('expo-image-picker') | null = null;
    try {
      ImagePicker = await import('expo-image-picker');
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
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
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
      await uploadPicked({
        uri: asset.uri,
        fileName: asset.fileName ?? `swing_${Date.now()}.${ext}`,
        mimeType:
          asset.mimeType ?? (ext === 'mov' ? 'video/quicktime' : 'video/mp4'),
        sizeBytes: asset.fileSize ?? null,
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
        <Text style={styles.dropTitle}>영상을 선택하세요</Text>
        <Text style={styles.dropMeta}>
          {Platform.OS === 'ios'
            ? '카메라로 찍은 영상은 「사진에서 선택」을 사용하세요.\nFiles 둘러보기에는 사진 앱 영상이 안 나와요.'
            : 'MP4 · MOV, 최대 200MB'}
        </Text>

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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="파일에서 선택"
          disabled={uploading}
          onPress={() => {
            void pickFromFiles();
          }}
          style={({ pressed }) => [
            styles.secondaryBtn,
            (pressed || uploading) && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryBtnText}>파일에서 선택</Text>
        </Pressable>

        {status ? <Text style={styles.status}>{status}</Text> : null}
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
