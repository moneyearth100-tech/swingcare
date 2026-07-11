/** 카메라 프리뷰 + MediaPipe 포즈 연결 (Step 2: 랜드마크 콘솔 검증) */

import { RNMediapipe } from '@thinksys/react-native-mediapipe';
import * as Device from 'expo-device';
import { useMemo } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePoseLandmarks } from '../hooks/usePoseLandmarks';

/**
 * Step 2 범위: RNMediapipe 카메라 + onLandmark → usePoseLandmarks.
 * 스켈레톤 Skia 오버레이·녹화·구간분할은 이후 단계.
 *
 * 실기기(Dev Client)에서만 카메라/포즈가 동작한다.
 * iOS 시뮬레이터에는 카메라가 없다.
 */
export default function SwingCaptureScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { onLandmark, isPoseDetected, frameCount, averageVisibility } =
    usePoseLandmarks({ enableLogging: true });

  const cameraSize = useMemo(() => {
    const width = Math.floor(windowWidth);
    const height = Math.floor(windowHeight - insets.top - insets.bottom);
    return { width, height };
  }, [insets.bottom, insets.top, windowHeight, windowWidth]);

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
    <View style={styles.root}>
      <RNMediapipe
        width={cameraSize.width}
        height={cameraSize.height}
        face
        leftArm
        rightArm
        leftWrist
        rightWrist
        torso
        leftLeg
        rightLeg
        leftAnkle
        rightAnkle
        frameLimit={30}
        onLandmark={onLandmark}
        style={styles.camera}
      />

      <View style={[styles.statusBar, { top: insets.top + 12 }]} pointerEvents="none">
        <Text style={styles.statusText}>
          {isPoseDetected ? '포즈 감지됨' : '포즈 대기 중'} · frame {frameCount} ·
          vis {averageVisibility.toFixed(2)}
        </Text>
        <Text style={styles.statusSub}>
          Metro 콘솔에서 [usePoseLandmarks] 로그를 확인하세요
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#16171F',
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
});
