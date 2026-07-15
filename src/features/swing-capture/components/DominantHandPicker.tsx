/**
 * 주손방향(우타/좌타) 선택 — 실시간·업로드 공용.
 * CameraAnglePicker와 동일한 세그먼트 패턴.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DOMINANT_HAND_OPTIONS,
  type DominantHand,
} from '@/features/auth/lib/profileTypes';

export interface DominantHandPickerProps {
  value: DominantHand | null;
  onChange: (hand: DominantHand | null) => void;
  /** panel: 카메라 오버레이용 / compact: 업로드 패널용 */
  variant?: 'panel' | 'compact';
  disabled?: boolean;
  prompt?: string;
}

export default function DominantHandPicker({
  value,
  onChange,
  variant = 'panel',
  disabled = false,
  prompt,
}: DominantHandPickerProps) {
  const isCompact = variant === 'compact';
  const title = prompt ?? '주손방향을 선택해 주세요';
  const body =
    '우타·좌타를 고르면 체중 이동·손목 코킹 표시를 맞춰 줘요. 선택하지 않아도 분석할 수 있어요.';

  return (
    <View style={[styles.wrap, isCompact && styles.wrapCompact]}>
      {prompt ? <Text style={styles.prompt}>{prompt}</Text> : null}

      <View style={[styles.segmented, isCompact && styles.segmentedCompact]}>
        {DOMINANT_HAND_OPTIONS.map((item) => {
          const active = value === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`주손방향 ${item.label}`}
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onChange(active ? null : item.id)}
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

      {isCompact ? (
        <Text style={styles.compactHint}>{body}</Text>
      ) : (
        <Text style={styles.panelHint}>
          {!prompt ? `${title} · ` : ''}
          {body}
        </Text>
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
  panelHint: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
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
