/** 카메라 프리뷰 + MediaPipe 포즈 + Skia 스켈레톤 + 스윙 녹화 버퍼 */

import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
} from 'expo-router';
import {
  RNMediapipe,
  startCameraRecording,
  stopCameraRecording,
} from '@thinksys/react-native-mediapipe';
import * as Device from 'expo-device';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import CameraAnglePicker, {
  type SelectableCameraAngle,
} from '../components/CameraAnglePicker';
import CaptureWarningBanners, {
  type CaptureWarningKind,
} from '../components/CaptureWarningBanners';
import DominantHandPicker from '../components/DominantHandPicker';
import SkeletonOverlay from '../components/SkeletonOverlay';
import SwingUploadPanel from '../components/SwingUploadPanel';
import { useDominantHandSelection } from '../hooks/useDominantHandSelection';
import { usePhaseSegmentation } from '../hooks/usePhaseSegmentation';
import { usePoseLandmarks } from '../hooks/usePoseLandmarks';
import { useSwingRecorder } from '../hooks/useSwingRecorder';
import { useSessionSyncRetryQueue } from '../hooks/useSyncOnForeground';
import { createEmptyPackedPosePoints } from '../lib/packedPosePoints';
import {
  isPoseEffectivelyAbsent,
  LOW_LIGHT_AVG_VISIBILITY,
} from '../lib/posePresence';
import {
  computeBalanceScore,
  formatBalanceScoreSummary,
  JOINT_LABEL_KO,
  type BalanceScoreResult,
} from '../lib/scoring/balanceScore';
import { BALANCE_SCORE_JOINTS } from '../lib/scoring/balanceScoreConstants';
import { matchDiagnosis } from '../lib/scoring/diagnosisTemplates';
import {
  buildSwingSession,
  saveSwingSessionLocalFirst,
  type StoredSwingSession,
} from '../store/swingSessionStore';
import type { CaptureSegment } from '../types';
import { upsertSwingReport } from '../../../services/supabase/swingReports';
import { attachVideoToSwingSession } from '../../../services/supabase/swingUpload';

/** 탭바 위 녹화 버튼 여백 */
const RECORD_BUTTON_GAP = 16;

/** 포즈 미인식 경고까지 대기 (ms) */
const POSE_LOST_WARN_MS = 2000;

function deleteTemporaryVideo(uri: string | null): void {
  if (!uri) {
    return;
  }
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn('[live video] temp cleanup failed', error);
  }
}

/**
 * Step 3–7: Skia 스켈레톤 + 녹화 + 구간 분할 + 세션 저장 + 에러/권한 UX.
 * thinksys 네이티브 뼈대 오버레이는 body-part props=false로 끈다.
 *
 * 실기기(Dev Client)에서만 카메라/포즈가 동작한다.
 * iOS 시뮬레이터에는 카메라가 없다.
 */
export default function SwingCaptureScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string | string[] }>();
  const mode =
    typeof modeParam === 'string'
      ? modeParam
      : Array.isArray(modeParam)
        ? modeParam[0]
        : undefined;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const displayPointsSV = useSharedValue(createEmptyPackedPosePoints());
  const viewSizeRef = useRef({ width: 0, height: 0 });
  const poseLostSinceRef = useRef<number | null>(null);
  const nativeVideoRecordingRef = useRef(false);
  const [lastStoredSession, setLastStoredSession] =
    useState<StoredSwingSession | null>(null);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [videoSaveError, setVideoSaveError] = useState<string | null>(null);
  const [showPoseLostWarn, setShowPoseLostWarn] = useState(false);
  /** 밸런스 지수 (화면 표시) */
  const [lastBalanceScore, setLastBalanceScore] = useState<BalanceScoreResult | null>(
    null,
  );
  const [reportSyncStatus, setReportSyncStatus] = useState<
    'idle' | 'saving' | 'synced' | 'error'
  >('idle');
  const [reportSyncError, setReportSyncError] = useState<string | null>(null);
  const [captureSegment, setCaptureSegment] = useState<CaptureSegment>(
    mode === 'upload' ? 'upload' : 'live',
  );
  const [cameraAngle, setCameraAngle] =
    useState<SelectableCameraAngle>('front');
  const { dominantHand, selectDominantHand, saving: savingHand } =
    useDominantHandSelection();

  useEffect(() => {
    // 홈 탭 push(?mode=)로 들어올 때만 URL과 맞춤.
    // 화면 안 세그먼트 전환은 selectSegment 로컬 상태가 우선.
    setCaptureSegment(mode === 'upload' ? 'upload' : 'live');
  }, [mode]);

  // 업로드 모드일 때 탭바 라벨을 「영상」으로 표시
  useEffect(() => {
    navigation.setOptions({
      title: captureSegment === 'upload' ? '영상' : '촬영',
    });
  }, [captureSegment, navigation]);

  useSessionSyncRetryQueue();

  useEffect(() => {
    return () => {
      if (!nativeVideoRecordingRef.current) {
        return;
      }
      nativeVideoRecordingRef.current = false;
      void stopCameraRecording()
        .then((uri) => deleteTemporaryVideo(uri))
        .catch((error) => {
          console.warn('[live video] unmount cleanup failed', error);
        });
    };
  }, []);

  const {
    isRecording,
    bufferedFrameCount,
    lastResult,
    startRecording,
    stopRecording,
    clearLastResult,
    appendRawFrameRef,
  } = useSwingRecorder();

  const { phases, warning: phaseWarning, segment, clear: clearPhases } =
    usePhaseSegmentation();

  /**
   * 녹화·저장 중이 아닐 때 직전 세션 결과 UI를 아이들 상태로 되돌림.
   * 탭이 언마운트되지 않아 리포트 상세 후 복귀/탭 전환 시 결과가 남는 문제 대응.
   */
  const resetPostSessionUi = useCallback(() => {
    clearPhases();
    clearLastResult();
    setLastStoredSession(null);
    setLastBalanceScore(null);
    setReportSyncStatus('idle');
    setReportSyncError(null);
    setVideoSaveError(null);
  }, [clearLastResult, clearPhases]);

  const isRecordingRef = useRef(isRecording);
  const isSavingSessionRef = useRef(isSavingSession);
  const isStartingRecordingRef = useRef(isStartingRecording);
  const captureSegmentRef = useRef(captureSegment);
  isRecordingRef.current = isRecording;
  isSavingSessionRef.current = isSavingSession;
  isStartingRecordingRef.current = isStartingRecording;
  captureSegmentRef.current = captureSegment;

  useFocusEffect(
    useCallback(() => {
      if (
        captureSegmentRef.current !== 'live' ||
        isRecordingRef.current ||
        isSavingSessionRef.current ||
        isStartingRecordingRef.current
      ) {
        return;
      }
      resetPostSessionUi();
    }, [resetPostSessionUi]),
  );

  /**
   * 실시간 ↔ 업로드 전환.
   * 홈 탭과 동일하게 /capture?mode= 로 이동해 SwingUploadPanel + 분석 파이프라인을 탄다.
   * setParams만 쓰면 탭 화면에서 mode가 안 바뀌어 업로드 패널이 바로 닫히는 경우가 있음.
   */
  const selectSegment = (next: CaptureSegment) => {
    if (next === captureSegment) {
      return;
    }
    if (next === 'upload' && isRecording) {
      stopRecording();
      if (nativeVideoRecordingRef.current) {
        nativeVideoRecordingRef.current = false;
        void stopCameraRecording()
          .then((uri) => deleteTemporaryVideo(uri))
          .catch((error) => {
            console.warn('[live video] discard failed', error);
          });
      }
      clearPhases();
    }
    if (
      next === 'live' &&
      !isRecording &&
      !isSavingSession &&
      !isStartingRecording
    ) {
      resetPostSessionUi();
    }
    setCaptureSegment(next);
    router.navigate(`/(tabs)/capture?mode=${next}`);
  };

  const cameraSize = useMemo(() => {
    const width = Math.floor(windowWidth);
    const height = Math.floor(windowHeight - insets.top - insets.bottom);
    return { width, height };
  }, [insets.bottom, insets.top, windowHeight, windowWidth]);

  viewSizeRef.current = cameraSize;

  const {
    onLandmark,
    isPoseDetected,
    frameCount,
    averageVisibility,
    rawLandmarks,
  } = usePoseLandmarks({
      enableLogging: false,
      onRawFrameRef: appendRawFrameRef,
      displayPointsSV,
      viewSizeRef,
    });

  /**
   * 미인식: 빈 landmarks 또는 몸통(어깨·엉덩이) visibility 부족.
   * iOS 렌즈 가림은 저조도로 오인되기 쉬워 전체 평균 대신 핵심 관절을 본다.
   */
  const isPoseAbsent = isPoseEffectivelyAbsent(
    rawLandmarks,
    averageVisibility,
  );

  useEffect(() => {
    if (!isPoseAbsent) {
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
  }, [isPoseAbsent]);

  const guidanceKind: CaptureWarningKind = useMemo(() => {
    if (isRecording || lastBalanceScore) {
      return null;
    }
    // 한 슬롯: 미인식 > 저조도 > 정면 가이드
    if (showPoseLostWarn && isPoseAbsent) {
      return 'pose_lost';
    }
    if (
      !isPoseAbsent &&
      isPoseDetected &&
      averageVisibility < LOW_LIGHT_AVG_VISIBILITY
    ) {
      return 'low_light';
    }
    return 'angle_guide';
  }, [
    averageVisibility,
    isPoseAbsent,
    isPoseDetected,
    isRecording,
    lastBalanceScore,
    showPoseLostWarn,
  ]);

  const recordButtonBottom = useMemo(() => {
    // iOS·Android 모두 플로팅 탭바 위에 두기
    return insets.bottom + BottomTabInset + RECORD_BUTTON_GAP;
  }, [insets.bottom]);

  const phaseSummary = useMemo(() => {
    if (phases.length === 0) {
      return null;
    }
    const detected = phases.filter((p) => p.source === 'detected').length;
    const interpolated = phases.filter((p) => p.source === 'interpolated').length;
    return `구간 ${phases.length} (탐지 ${detected} · 보간 ${interpolated})`;
  }, [phases]);

  const handleRecordPress = async () => {
    if (isStartingRecording || isSavingSession) {
      return;
    }

    if (isRecording) {
      setIsSavingSession(true);
      const result = stopRecording();
      let localVideoUri: string | null = null;
      if (nativeVideoRecordingRef.current) {
        nativeVideoRecordingRef.current = false;
        try {
          localVideoUri = await stopCameraRecording();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : '영상 파일 저장 실패';
          setVideoSaveError(message);
          console.warn('[live video] stop failed', error);
        }
      }

      if (!result || result.frames.length === 0) {
        deleteTemporaryVideo(localVideoUri);
        resetPostSessionUi();
        setIsSavingSession(false);
        return;
      }

      const segmentResult = segment(result.frames, { dominantHand });
      const balanceScore = computeBalanceScore(
        result.frames,
        segmentResult.phases,
        { dominantHand },
      );
      setLastBalanceScore(balanceScore);
      console.log('[balanceScore]', {
        summary: formatBalanceScoreSummary(balanceScore),
        version: balanceScore.version,
        overall: balanceScore.overallScore,
        joints: Object.fromEntries(
          BALANCE_SCORE_JOINTS.map((j) => [j, balanceScore.joints[j].score]),
        ),
        movement: balanceScore.movementMetrics,
        warning: balanceScore.warning,
      });

      const session = buildSwingSession({
        frames: result.frames,
        phases: segmentResult.phases,
        durationMs: result.durationMs,
        cameraAngle,
      });

      setReportSyncStatus('saving');
      setReportSyncError(null);
      void saveSwingSessionLocalFirst(session)
        .then(async (stored) => {
          setLastStoredSession(stored);
          if (stored.syncStatus !== 'synced' || !stored.userId) {
            setReportSyncStatus('error');
            setReportSyncError(
              stored.lastSyncError ?? 'session not synced — report skipped',
            );
            return;
          }

          if (localVideoUri) {
            const attached = await attachVideoToSwingSession({
              sessionId: stored.id,
              localUri: localVideoUri,
              fileName: `live_${stored.id}.mp4`,
              mimeType: 'video/mp4',
            });
            if (!attached.ok) {
              setVideoSaveError(attached.message);
              console.warn('[live video] upload failed', attached.message);
            } else {
              setVideoSaveError(null);
              console.log('[live video] attached', stored.id);
            }
          }

          const diagnosis = matchDiagnosis(balanceScore, segmentResult.phases, {
            dominantHand,
          });
          console.log('[diagnosis]', {
            patternId: diagnosis.patternId,
            issuePhase: diagnosis.issuePhase,
            drill: diagnosis.template.recommendedDrillId,
            tag: diagnosis.template.tagLabel,
            facts: diagnosis.facts.map((f) => f.text),
          });

          const reportResult = await upsertSwingReport({
            sessionId: stored.id,
            userId: stored.userId,
            balanceScore,
            issuePhase: diagnosis.issuePhase,
            diagnosisText: diagnosis.diagnosisText,
            recommendedDrillId: diagnosis.template.recommendedDrillId,
          });
          if (reportResult.ok) {
            setReportSyncStatus('synced');
            console.log('[swing_reports] synced', stored.id, {
              issue_phase: diagnosis.issuePhase,
              recommended_drill_id: diagnosis.template.recommendedDrillId,
            });
          } else {
            setReportSyncStatus('error');
            setReportSyncError(reportResult.message);
          }
        })
        .catch(() => {
          setLastStoredSession({
            ...session,
            syncStatus: 'error',
            lastSyncError: 'local save failed',
          });
          setReportSyncStatus('error');
          setReportSyncError('local save failed');
        })
        .finally(() => {
          deleteTemporaryVideo(localVideoUri);
          setIsSavingSession(false);
        });
      return;
    }
    resetPostSessionUi();
    setIsStartingRecording(true);
    try {
      await startCameraRecording();
      nativeVideoRecordingRef.current = true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '네이티브 영상 녹화를 시작하지 못했어요';
      setVideoSaveError(message);
      console.warn('[live video] start failed', error);
      Alert.alert(
        '영상 녹화 시작 실패',
        '스켈레톤 분석은 계속할 수 있지만 영상은 저장되지 않아요. Dev Client를 새로 빌드했는지 확인해 주세요.',
      );
    } finally {
      startRecording();
      setIsStartingRecording(false);
    }
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

  const segmentControl = (
    <View style={styles.segmented}>
      {(
        [
          { id: 'live' as const, label: '실시간 촬영' },
          { id: 'upload' as const, label: '영상 업로드' },
        ] as const
      ).map((item) => {
        const active = captureSegment === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => selectSegment(item.id)}
            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
          >
            <Text
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (captureSegment === 'upload') {
    return (
      <View style={styles.uploadRoot}>
        <View style={[styles.uploadTopbar, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.uploadTitle}>영상</Text>
          <Text style={styles.uploadSub}>
            동영상으로 기록된 스윙을 분석해요
          </Text>
        </View>
        <View style={styles.segmentWrap}>{segmentControl}</View>
        <SwingUploadPanel bottomInset={insets.bottom + BottomTabInset} />
      </View>
    );
  }

  if (!Device.isDevice) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>스윙 캡처</Text>
        <Text style={styles.hint}>
          시뮬레이터에서는 카메라가 동작하지 않습니다. 실기기에 Dev Client를
          설치한 뒤 테스트해주세요. 업로드는 아래에서 가능합니다.
        </Text>
        <View style={styles.segmentWrap}>{segmentControl}</View>
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

        <View
          style={[styles.topOverlay, { top: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          {segmentControl}
          {!isRecording && !lastBalanceScore ? (
            <View style={styles.anglePickerLive}>
              <CameraAnglePicker
                value={cameraAngle}
                onChange={setCameraAngle}
                variant="panel"
              />
              <DominantHandPicker
                value={dominantHand}
                onChange={selectDominantHand}
                variant="panel"
                disabled={savingHand}
              />
            </View>
          ) : null}
          <CaptureWarningBanners
            kind={guidanceKind === 'angle_guide' ? null : guidanceKind}
            cameraAngle={cameraAngle}
          />
          <View style={styles.statusBar} pointerEvents="box-none">
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
          {videoSaveError ? (
            <Text style={styles.videoError}>영상 저장 실패 · 스켈레톤은 정상 저장돼요</Text>
          ) : null}
          {!isRecording && lastBalanceScore ? (
            <View style={styles.tempScoreBox}>
              <Text style={styles.tempScoreTitle}>밸런스 지수</Text>
              <Text style={styles.tempScoreMain}>
                종합 {lastBalanceScore.overallScore}
              </Text>
              <Text style={styles.tempScoreJoints}>
                {BALANCE_SCORE_JOINTS.map(
                  (j) => `${JOINT_LABEL_KO[j]} ${lastBalanceScore.joints[j].score}`,
                ).join(' · ')}
              </Text>
              <Text style={styles.tempScoreJoints}>
                report{' '}
                {reportSyncStatus === 'idle'
                  ? '—'
                  : reportSyncStatus === 'saving'
                    ? '저장 중…'
                    : reportSyncStatus === 'synced'
                      ? 'synced'
                      : `error${reportSyncError ? ` (${reportSyncError})` : ''}`}
              </Text>
              {reportSyncStatus === 'synced' && lastStoredSession ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    router.push(`/report/${lastStoredSession.id}`);
                  }}
                  style={styles.reportLink}
                >
                  <Text style={styles.reportLinkLabel}>리포트 상세 보기</Text>
                </Pressable>
              ) : null}
              {lastBalanceScore.warning ? (
                <Text style={styles.tempScoreWarn}>{lastBalanceScore.warning}</Text>
              ) : null}
            </View>
          ) : null}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isStartingRecording ? '녹화 준비 중' : isRecording ? '녹화 종료' : '녹화 시작'
          }
          disabled={isStartingRecording || isSavingSession}
          onPress={() => void handleRecordPress()}
          style={[
            styles.recordButton,
            { bottom: recordButtonBottom },
            isRecording && styles.recordButtonActive,
            (isStartingRecording || isSavingSession) && styles.recordButtonDisabled,
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
  uploadRoot: {
    flex: 1,
    backgroundColor: '#FDFDFD',
  },
  uploadTopbar: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  uploadTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#232630',
  },
  uploadSub: {
    marginTop: 3,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#7A8198',
  },
  segmentWrap: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  topOverlay: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 50,
    elevation: 50,
    gap: 10,
  },
  anglePickerLive: {
    marginTop: 2,
    gap: 10,
  },
  segmented: {
    flexDirection: 'row',
    padding: 5,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
    gap: 2,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  segmentLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#7A8198',
  },
  segmentLabelActive: {
    color: '#232630',
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
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 11,
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
  videoError: {
    marginTop: 4,
    color: '#FFD0D7',
    fontSize: 10.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  tempScoreBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    gap: 2,
  },
  tempScoreTitle: {
    color: 'rgba(255,200,120,0.95)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tempScoreMain: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  tempScoreJoints: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
  },
  tempScoreWarn: {
    marginTop: 2,
    color: 'rgba(255,180,160,0.95)',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  reportLink: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(47,107,255,0.85)',
  },
  reportLinkLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
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
  recordButtonDisabled: {
    opacity: 0.55,
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
