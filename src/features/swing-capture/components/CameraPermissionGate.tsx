/**
 * 카메라 권한 거부·미요청 시 안내 게이트.
 * 권한이 있을 때만 children(카메라)을 마운트한다.
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
  const [isRequesting, setIsRequesting] = useState(false);

  const tryRequest = useCallback(async () => {
    if (!canRequestPermission || isRequesting) {
      return;
    }
    setIsRequesting(true);
    try {
      await requestPermission();
    } finally {
      setIsRequesting(false);
    }
  }, [canRequestPermission, isRequesting, requestPermission]);

  useEffect(() => {
    if (!hasPermission && canRequestPermission) {
      void tryRequest();
    }
  }, [canRequestPermission, hasPermission, tryRequest]);

  // 설정 앱에서 권한 켠 뒤 복귀 시 훅 status 갱신 유도
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !hasPermission && canRequestPermission) {
        void tryRequest();
      }
    });
    return () => sub.remove();
  }, [canRequestPermission, hasPermission, tryRequest]);

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
      {canRequestPermission ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="카메라 권한 허용"
          onPress={() => {
            void tryRequest();
          }}
          style={styles.button}
          disabled={isRequesting}
        >
          <Text style={styles.buttonText}>
            {isRequesting ? '요청 중…' : '권한 허용하기'}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="설정 앱 열기"
          onPress={() => {
            void Linking.openSettings();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>설정에서 허용하기</Text>
        </Pressable>
      )}
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
