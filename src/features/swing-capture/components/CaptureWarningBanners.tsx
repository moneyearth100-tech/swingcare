/**
 * 저조도·포즈 미인식 경고 배너.
 * 우선순위: 포즈 미인식 > 저조도 (동시 표시 안 함).
 */

import { StyleSheet, Text, View } from 'react-native';

export type CaptureWarningKind = 'pose_lost' | 'low_light' | null;

export interface CaptureWarningBannersProps {
  kind: CaptureWarningKind;
  /** statusBar 아래 여백용 */
  top: number;
}

export default function CaptureWarningBanners({
  kind,
  top,
}: CaptureWarningBannersProps) {
  if (kind == null) {
    return null;
  }

  const isPoseLost = kind === 'pose_lost';

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="none">
      <View style={[styles.banner, isPoseLost ? styles.poseLost : styles.lowLight]}>
        <Text style={styles.text}>
          {isPoseLost
            ? '카메라 각도를 조정해주세요'
            : '조명이 어두워요. 밝은 곳에서 다시 촬영해 주세요.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 40,
  },
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lowLight: {
    backgroundColor: 'rgba(255, 180, 60, 0.22)',
    borderColor: 'rgba(255, 180, 60, 0.45)',
  },
  poseLost: {
    backgroundColor: 'rgba(80, 140, 255, 0.22)',
    borderColor: 'rgba(80, 140, 255, 0.45)',
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 17,
  },
});
