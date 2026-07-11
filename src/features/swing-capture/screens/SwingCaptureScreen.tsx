/** 카메라 프리뷰 + MediaPipe 포즈 + Skia 스켈레톤 + 스윙 녹화 버퍼 */

import { RNMediapipe } from '@thinksys/react-native-mediapipe';
import * as Device from 'expo-device';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';

import CameraPermissionGate from '../components/CameraPermissionGate';
import CaptureWarningBanners from '../components/CaptureWarningBanners';
import SkeletonOverlay from '../components/SkeletonOverlay';
import { usePhaseSegmentation } from '../hooks/usePhaseSegmentation';
import { usePoseLandmarks } from '../hooks/usePoseLandmarks';
import { useSwingRecorder } from '../hooks/useSwingRecorder';
import { useSyncOnForeground } from '../hooks/useSyncOnForeground';
import { createEmptyPackedPosePoints } from '../lib/packedPosePoints';
import {
  buildSwingSession,
  saveSwingSessionLocalFirst,
  type StoredSwingSession,
} from '../store/swingSessionStore';

/** 탭바 위 녹화 버튼 여백 (iOS만 탭바와 겹침 보정) */
const RECORD_BUTTON_GAP_IOS = 16;
const RECORD_BUTTON_BOTTOM_ANDROID = 28;

/** 저조도 경고 — 랜드마크 평균 visibility 임계값 (6장) */
const LOW_LIGHT_VISIBILITY_THRESHOLD = 0.5;
/** 포즈 미인식 경고까지 대기 (ms) (6장) */
const POSE_LOST_WARN_MS = 2000;
/** 상태바 아래 경고 배너 간격 */
const WARNING_BANNER_GAP_BELOW_STATUS = 72;

/**
 * Step 3–7: Skia 스켈레톤 + 녹화 + 구간 분할 + 세션 저장 + 에러/권한 UX.
 * thinksys 네이티브 뼈대 오버레이는 body-part props=false로 끈다.
 *
 * 실기기(Dev Client)에서만 카메라/포즈가 동작한다.
 * iOS 시뮬레이터에는 카메라가 없다.
 */
export default function SwingCaptureScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const displayPointsSV = useSharedValue(createEmptyPackedPosePoints());
  const viewSizeRef = useRef({ width: 0, height: 0 });
  const poseLostSinceRef = useRef<number | null>(null);
  const [lastStoredSession, setLastStoredSession] =
    useState<StoredSwingSession | null>(null);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [showPoseLostWarn, setShowPoseLostWarn] = useState(false);

  useSyncOnForeground();

  const {
    isRecording,
    bufferedFrameCount,
    lastResult,
    startRecording,
    stopRecording,
    appendRawFrameRef,
  } = useSwingRecorder();

  const { phases, warning: phaseWarning, segment, clear: clearPhases } =
    usePhaseSegmentation();

  const cameraSize = useMemo(() => {
    const width = Math.floor(windowWidth);
    const height = Math.floor(windowHeight - insets.top - insets.bottom);
    return { width, height };
  }, [insets.bottom, insets.top, windowHeight, windowWidth]);

  viewSizeRef.current = cameraSize;

  const { onLandmark, isPoseDetected, frameCount, averageVisibility } =
    usePoseLandmarks({
      enableLogging: false,
      onRawFrameRef: appendRawFrameRef,
      displayPointsSV,
      viewSizeRef,
    });

  useEffect(() => {
    if (isPoseDetected) {
      poseLostSinceRef.current = null;
      setShowPoseLostWarn(false);
      return;
    }
    if (poseLostSinceRef.current == null) {
      poseLostSinceRef.current = Date.now();
    }
    const timer = setInterval(() => {
      const since = poseLostSinceRef.current;
      if (since != null && Date.now() - since >= POSE_LOST_WARN_MS) {
        setShowPoseLostWarn(true);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isPoseDetected]);

  const showLowLight =
    isPoseDetected && averageVisibility < LOW_LIGHT_VISIBILITY_THRESHOLD;

  const recordButtonBottom = useMemo(() => {
    if (Platform.OS === 'ios') {
      return insets.bottom + BottomTabInset + RECORD_BUTTON_GAP_IOS;
    }
    return RECORD_BUTTON_BOTTOM_ANDROID;
  }, [insets.bottom]);

  const phaseSummary = useMemo(() => {
    if (phases.length === 0) {
      return null;
    }
    const detected = phases.filter((p) => p.source === 'detected').length;
    const interpolated = phases.filter((p) => p.source === 'interpolated').length;
    return `구간 ${phases.length} (탐지 ${detected} · 보간 ${interpolated})`;
  }, [phases]);

  const handleRecordPress = () => {
    if (isRecording) {
      const result = stopRecording();
      if (!result || result.frames.length === 0) {
        clearPhases();
        setLastStoredSession(null);
        return;
      }

      const segmentResult = segment(result.frames);
      const session = buildSwingSession({
        frames: result.frames,
        phases: segmentResult.phases,
        durationMs: result.durationMs,
      });

      setIsSavingSession(true);
      void saveSwingSessionLocalFirst(session)
        .then((stored) => {
          setLastStoredSession(stored);
        })
        .catch(() => {
          setLastStoredSession({
            ...session,
            syncStatus: 'error',
            lastSyncError: 'local save failed',
          });
        })
        .finally(() => {
          setIsSavingSession(false);
        });
      return;
    }
    clearPhases();
    setLastStoredSession(null);
    startRecording();
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>스윙 캡처</Text>
        <Text style={styles.hint}>
          웹에서는 카메라·포즈 인식이 지원되지 않습니다. Dev Client로 실기기에서
          열어주세요.
        </Text>
      </View>
    );
  }

  if (!Device.isDevice) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>스윙 캡처</Text>
        <Text style={styles.hint}>
          시뮬레이터에서는 카메라가 동작하지 않습니다. 실기기에 Dev Client를
          설치한 뒤 테스트해주세요.
        </Text>
      </View>
    );
  }

  return (
    <CameraPermissionGate>
      <View style={styles.root}>
        <View style={[styles.cameraWrap, cameraSize]}>
          <RNMediapipe
            width={cameraSize.width}
            height={cameraSize.height}
            // thinksys 내장 스켈레톤 OFF — Skia SkeletonOverlay로 대체
            face={false}
            leftArm={false}
            rightArm={false}
            leftWrist={false}
            rightWrist={false}
            torso={false}
            leftLeg={false}
            rightLeg={false}
            leftAnkle={false}
            rightAnkle={false}
            frameLimit={30}
            onLandmark={onLandmark}
            style={styles.camera}
          />
          <SkeletonOverlay
            pointsSV={displayPointsSV}
            width={cameraSize.width}
            height={cameraSize.height}
          />
        </View>

        <View style={[styles.statusBar, { top: insets.top + 12 }]} pointerEvents="none">
          <Text style={styles.statusText}>
            {isRecording ? '녹화 중' : isPoseDetected ? '포즈 감지됨' : '포즈 대기 중'}
            {' · '}
            live {frameCount}
            {isRecording ? ` · buf ${bufferedFrameCount}` : ''}
            {' · '}
            vis {averageVisibility.toFixed(2)}
          </Text>
          <Text style={styles.statusSub}>
            {isSavingSession
              ? '세션 저장 중…'
              : lastResult
                ? `직전 녹화: ${lastResult.frames.length}프레임 / ${lastResult.durationMs}ms${
                    phaseSummary ? ` · ${phaseSummary}` : ''
                  }${
                    lastStoredSession
                      ? ` · 저장 ${lastStoredSession.syncStatus}${
                          lastStoredSession.lastSyncError
                            ? ` (${lastStoredSession.lastSyncError})`
                            : ''
                        }`
                      : ''
                  }${phaseWarning ? ` · ${phaseWarning}` : ''}`
                : 'Skia 스켈레톤 · 녹화 종료 시 구간 분할·로컬 저장'}
          </Text>
        </View>

        <CaptureWarningBanners
          top={insets.top + 12 + WARNING_BANNER_GAP_BELOW_STATUS}
          showLowLight={showLowLight}
          showPoseLost={showPoseLostWarn && !isRecording}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? '녹화 종료' : '녹화 시작'}
          onPress={handleRecordPress}
          style={[
            styles.recordButton,
            { bottom: recordButtonBottom },
            isRecording && styles.recordButtonActive,
          ]}
        >
          <View
            style={[styles.recordInner, isRecording && styles.recordInnerActive]}
          />
        </Pressable>
      </View>
    </CameraPermissionGate>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#16171F',
  },
  cameraWrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  center: {
    flex: 1,
    backgroundColor: '#FDFDFD',
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#232630',
  },
  hint: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 22,
  },
  statusBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    zIndex: 30,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusSub: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  recordButton: {
    position: 'absolute',
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    zIndex: 20,
  },
  recordButtonActive: {
    borderColor: 'rgba(255,117,140,0.55)',
  },
  recordInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
  },
  recordInnerActive: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#FF758C',
  },
});
