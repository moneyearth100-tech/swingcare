/**
 * 카메라 권한 거부 시 캡처 화면 대신 안내 UI.
 * CTA는 앱 설정으로 딥링크한다.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface CameraPermissionGateProps {
  children: ReactNode;
}

export default function CameraPermissionGate({
  children,
}: CameraPermissionGateProps) {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission, canRequestPermission } =
    useCameraPermission();
  const [didAutoRequest, setDidAutoRequest] = useState(false);

  const openAppSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  // 최초 1회 시스템 권한 다이얼로그 (아직 미결정일 때)
  useEffect(() => {
    if (hasPermission || didAutoRequest || !canRequestPermission) {
      return;
    }
    setDidAutoRequest(true);
    void requestPermission();
  }, [canRequestPermission, didAutoRequest, hasPermission, requestPermission]);

  // 설정에서 권한 켠 뒤 복귀 시 — 미결정이면 재요청
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || hasPermission) {
        return;
      }
      if (canRequestPermission) {
        void requestPermission();
      }
    });
    return () => sub.remove();
  }, [canRequestPermission, hasPermission, requestPermission]);

  if (hasPermission) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>카메라 권한이 필요합니다</Text>
      <Text style={styles.body}>
        스윙 자세 안내를 위해 카메라 접근이 필요합니다. 권한이 꺼져 있으면 촬영을
        시작할 수 없습니다.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="설정에서 카메라 권한 허용하기"
        onPress={openAppSettings}
        style={styles.button}
      >
        <Text style={styles.buttonText}>설정에서 카메라 권한 허용하기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FDFDFD',
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#232630',
  },
  body: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#208AEF',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
