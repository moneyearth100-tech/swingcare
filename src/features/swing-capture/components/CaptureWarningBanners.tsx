/**
 * 저조도·포즈 미인식 경고 배너 (캡처 화면 오버레이).
 */

import { StyleSheet, Text, View } from 'react-native';

export interface CaptureWarningBannersProps {
  showLowLight: boolean;
  showPoseLost: boolean;
  /** statusBar 아래 여백용 */
  top: number;
}

export default function CaptureWarningBanners({
  showLowLight,
  showPoseLost,
  top,
}: CaptureWarningBannersProps) {
  if (!showLowLight && !showPoseLost) {
    return null;
  }

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="none">
      {showLowLight ? (
        <View style={[styles.banner, styles.lowLight]}>
          <Text style={styles.text}>
            조도가 낮아 자세 인식이 불안정할 수 있습니다. 밝은 곳으로 이동해
            주세요.
          </Text>
        </View>
      ) : null}
      {showPoseLost ? (
        <View style={[styles.banner, styles.poseLost]}>
          <Text style={styles.text}>
            포즈가 감지되지 않습니다. 카메라 각도를 조정해 주세요.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    gap: 8,
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
