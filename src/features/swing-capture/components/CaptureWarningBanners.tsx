/**
 * 촬영 안내·경고 — 한 슬롯에 하나만 표시.
 * 우선순위: 포즈 미인식 > 저조도 > 촬영 각도 가이드
 */

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import type { SelectableCameraAngle } from './CameraAnglePicker';

export type CaptureWarningKind =
  | 'pose_lost'
  | 'low_light'
  | 'angle_guide'
  | null;

export interface CaptureWarningBannersProps {
  kind: CaptureWarningKind;
  /** angle_guide일 때 정면/측면 카피 */
  cameraAngle?: SelectableCameraAngle;
}

const ANGLE_GUIDE_COPY: Record<
  SelectableCameraAngle,
  { title: string; body: string }
> = {
  front: {
    title: '정면에서 촬영해 주세요',
    body: '카메라가 골퍼의 얼굴을 바라보도록 세워 주세요.',
  },
  side: {
    title: '측면에서 촬영해 주세요',
    body: '공이 나아갈 방향의 뒤에서 스윙면이 보이도록 세워 주세요.',
  },
};

const GUIDANCE_COPY: Record<
  Exclude<CaptureWarningKind, 'angle_guide' | null>,
  { title: string; body?: string }
> = {
  pose_lost: {
    title: '카메라 각도를 조정해주세요',
    body: '몸 전체가 화면에 보이도록 카메라 위치를 바꿔 주세요.',
  },
  low_light: {
    title: '조명이 어두워요',
    body: '밝은 곳에서 다시 촬영해 주세요.',
  },
};

export default function CaptureWarningBanners({
  kind,
  cameraAngle = 'front',
}: CaptureWarningBannersProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    opacity.stopAnimation();
    if (kind !== 'angle_guide') {
      opacity.setValue(1);
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
  }, [kind, cameraAngle, opacity]);

  if (kind == null) {
    return null;
  }

  const copy =
    kind === 'angle_guide'
      ? ANGLE_GUIDE_COPY[cameraAngle]
      : GUIDANCE_COPY[kind];
  const toneStyle =
    kind === 'pose_lost'
      ? styles.poseLost
      : kind === 'low_light'
        ? styles.lowLight
        : styles.angleGuide;

  return (
    <Animated.View style={{ opacity }} pointerEvents="none">
      <View style={[styles.banner, toneStyle]}>
        <Text style={styles.title}>{copy.title}</Text>
        {copy.body ? <Text style={styles.body}>{copy.body}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  lowLight: {
    backgroundColor: 'rgba(255, 180, 60, 0.22)',
    borderColor: 'rgba(255, 180, 60, 0.45)',
  },
  poseLost: {
    backgroundColor: 'rgba(80, 140, 255, 0.22)',
    borderColor: 'rgba(80, 140, 255, 0.45)',
  },
  angleGuide: {
    backgroundColor: 'rgba(22, 24, 32, 0.82)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  title: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 18,
  },
  body: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
  },
});
