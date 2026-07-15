/**
 * 촬영 각도(정면/측면) 선택 — 실시간·업로드 공용.
 * front = 정면(마주보기), side = 측면(공이 나아갈 방향 뒤).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

export type SelectableCameraAngle = 'front' | 'side';

export interface CameraAnglePickerProps {
  value: SelectableCameraAngle;
  onChange: (angle: SelectableCameraAngle) => void;
  /** panel: 일러스트 포함 / compact: 세그먼트만 */
  variant?: 'panel' | 'compact';
  disabled?: boolean;
  /** 업로드 플로우용 질문 문구 */
  prompt?: string;
}

const OPTIONS: { id: SelectableCameraAngle; label: string }[] = [
  { id: 'front', label: '정면' },
  { id: 'side', label: '측면' },
];

function FrontIllustration() {
  return (
    <View style={styles.illustration} accessibilityLabel="정면 촬영 예시">
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
  );
}

function SideIllustration() {
  return (
    <View style={styles.illustration} accessibilityLabel="측면 촬영 예시">
      <View style={styles.sideStack}>
        <View style={styles.sideHead} />
        <View style={styles.sideTorso} />
        <View style={styles.sideLegFront} />
        <View style={[styles.sideArm, styles.sideArmRaise]} />
        <View style={styles.sideClub} />
      </View>
      <Text style={styles.illustCaption}>측면</Text>
    </View>
  );
}

export default function CameraAnglePicker({
  value,
  onChange,
  variant = 'panel',
  disabled = false,
  prompt,
}: CameraAnglePickerProps) {
  const showIllustration = variant === 'panel';
  const title =
    prompt ??
    (value === 'front'
      ? '정면에서 촬영해 주세요'
      : '측면에서 촬영해 주세요');
  const body =
    value === 'front'
      ? '정면은 어드레스하는 나를 마주보는 각도예요. 카메라가 골퍼의 얼굴을 바라보도록 세워 주세요.'
      : '측면은 공이 나아갈 방향의 뒤에서 찍는 각도예요. 스윙면이 옆에서 보이도록 세워 주세요.';

  const isCompact = variant === 'compact';

  return (
    <View style={[styles.wrap, isCompact && styles.wrapCompact]}>
      {prompt ? <Text style={styles.prompt}>{prompt}</Text> : null}

      <View style={[styles.segmented, isCompact && styles.segmentedCompact]}>
        {OPTIONS.map((item) => {
          const active = value === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onChange(item.id)}
              style={[
                styles.segmentBtn,
                isCompact && styles.segmentBtnCompact,
                active &&
                  (isCompact
                    ? styles.segmentBtnActiveCompact
                    : styles.segmentBtnActive),
              ]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  isCompact && styles.segmentLabelCompact,
                  active &&
                    (isCompact
                      ? styles.segmentLabelActiveCompact
                      : styles.segmentLabelActive),
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showIllustration ? (
        <View style={styles.card}>
          {value === 'front' ? <FrontIllustration /> : <SideIllustration />}
          {!prompt ? <Text style={styles.title}>{title}</Text> : null}
          <Text style={styles.body}>{body}</Text>
        </View>
      ) : (
        <Text style={styles.compactHint}>{body}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  wrapCompact: {
    gap: 8,
  },
  prompt: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#232630',
    textAlign: 'center',
    lineHeight: 20,
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  segmentedCompact: {
    backgroundColor: 'rgba(40,50,80,0.08)',
  },
  segmentBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 72,
    alignItems: 'center',
  },
  segmentBtnCompact: {
    minWidth: 88,
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  segmentBtnActiveCompact: {
    backgroundColor: '#2F6BFF',
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
  },
  segmentLabelCompact: {
    color: '#4A5168',
  },
  segmentLabelActive: {
    color: '#232630',
  },
  segmentLabelActiveCompact: {
    color: '#FFFFFF',
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(22, 24, 32, 0.82)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 6,
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
  sideStack: {
    width: 72,
    height: 78,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  sideHead: {
    position: 'absolute',
    top: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(201,184,255,0.85)',
  },
  sideTorso: {
    position: 'absolute',
    top: 22,
    width: 18,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(201,184,255,0.55)',
  },
  sideLegFront: {
    width: 12,
    height: 26,
    borderRadius: 6,
    backgroundColor: 'rgba(201,184,255,0.4)',
    marginBottom: 2,
  },
  sideArm: {
    position: 'absolute',
    top: 28,
    left: 8,
    width: 10,
    height: 30,
    borderRadius: 5,
    backgroundColor: 'rgba(201,184,255,0.45)',
  },
  sideArmRaise: {
    transform: [{ rotate: '-55deg' }],
  },
  sideClub: {
    position: 'absolute',
    top: 8,
    right: 6,
    width: 3,
    height: 48,
    borderRadius: 2,
    backgroundColor: 'rgba(201,184,255,0.55)',
    transform: [{ rotate: '28deg' }],
  },
  illustCaption: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 17,
    textAlign: 'center',
  },
  compactHint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
