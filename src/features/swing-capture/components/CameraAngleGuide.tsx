/**
 * 촬영 전 정면(마주보기) 가이드 — 정적 오버레이.
 * 실시간 각도 판별 없음. 듀얼폰 시 카메라 안내와 같은 문구 패턴 재사용 전제.
 */

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export interface CameraAngleGuideProps {
  /** 녹화 중이면 숨김 */
  visible: boolean;
}

export default function CameraAngleGuide({ visible }: CameraAngleGuideProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) {
      opacity.stopAnimation();
      return;
    }

    opacity.setValue(1);
    const animation = Animated.sequence([
      Animated.delay(5000),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [opacity, visible]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
      <View style={styles.card}>
        <Text style={styles.title}>정면에서 촬영해 주세요</Text>
        <Text style={styles.body}>
          정면은 어드레스하는 나를 마주보는 각도예요. 카메라가 골퍼의 얼굴을
          바라보도록 세워 주세요.
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingBottom: 140,
  },
  card: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(22, 24, 32, 0.82)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: {
    fontSize: 12.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 18,
    textAlign: 'center',
  },
});
