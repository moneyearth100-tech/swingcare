/**
 * 촬영 전 정면(마주보기) 가이드 — 정적 오버레이.
 * 실시간 각도 판별 없음. 듀얼폰 시 후면 안내와 같은 문구 패턴 재사용 전제.
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
        <View style={styles.illustration} accessibilityLabel="정면 촬영 예시">
          {/* 간단한 정면(마주보기) 실루엣 */}
          <View style={styles.head} />
          <View style={styles.torso} />
          <View style={styles.armsRow}>
            <View style={[styles.arm, styles.armLeft]} />
            <View style={[styles.arm, styles.armRight]} />
          </View>
          <View style={styles.legsRow}>
            <View style={styles.leg} />
            <View style={styles.leg} />
          </View>
          <Text style={styles.illustCaption}>정면</Text>
        </View>
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
  illustration: {
    alignSelf: 'center',
    alignItems: 'center',
    width: 88,
    paddingVertical: 6,
    marginBottom: 2,
  },
  head: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(201,184,255,0.85)',
  },
  torso: {
    marginTop: 4,
    width: 36,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(201,184,255,0.55)',
  },
  armsRow: {
    position: 'absolute',
    top: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  arm: {
    width: 10,
    height: 34,
    borderRadius: 5,
    backgroundColor: 'rgba(201,184,255,0.45)',
  },
  armLeft: { transform: [{ rotate: '18deg' }] },
  armRight: { transform: [{ rotate: '-18deg' }] },
  legsRow: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 8,
  },
  leg: {
    width: 12,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(201,184,255,0.4)',
  },
  illustCaption: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.5,
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
