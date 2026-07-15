/**
 * GolfDB 8단계 구간 타임라인 — detected/interpolated 시각 구분.
 * is-issue(문제 구간)는 이번 스프린트에서 비활성.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PhaseMarker, SwingPhase } from '../lib/landmarkTypes';
import { SWING_PHASES } from '../lib/landmarkTypes';

const PHASE_LABELS: Record<SwingPhase, string> = {
  address: '어드레스',
  toe_up: '토우업',
  mid_backswing: '백스윙중',
  top: '탑',
  mid_downswing: '다운스윙중',
  impact: '임팩트',
  mid_follow_through: '팔로우중',
  finish: '피니시',
};

export interface PhaseTimelineProps {
  phases: readonly PhaseMarker[];
  /** 미디어 시계에서 계산한 현재 구간. 재생 중 timestamp 전체를 prop으로 보내지 않기 위한 경량 경로. */
  currentPhase?: SwingPhase | null;
  /** 현재 재생 위치. 없으면 기존 정적 타임라인으로 표시한다. */
  currentTimestampMs?: number;
}

export function findCurrentPhase(
  phases: readonly PhaseMarker[],
  timestampMs: number,
): SwingPhase | null {
  let current: PhaseMarker | null = null;
  for (const marker of phases) {
    if (
      marker.timestampMs <= timestampMs &&
      (current == null || marker.timestampMs >= current.timestampMs)
    ) {
      current = marker;
    }
  }
  return current?.phase ?? null;
}

function PhaseTimeline({
  phases,
  currentPhase: currentPhaseProp,
  currentTimestampMs,
}: PhaseTimelineProps) {
  const byPhase = new Map(phases.map((p) => [p.phase, p]));
  const currentPhase =
    currentPhaseProp !== undefined
      ? currentPhaseProp
      : currentTimestampMs == null
        ? null
        : findCurrentPhase(phases, currentTimestampMs);

  return (
    <View style={styles.track} accessibilityRole="summary">
      <View style={styles.line} />
      <View style={styles.dots}>
        {SWING_PHASES.map((phase) => {
          const marker = byPhase.get(phase);
          const source = marker?.source ?? 'interpolated';
          const detected = source === 'detected';
          const current = phase === currentPhase;
          return (
            <View key={phase} style={styles.dotWrap}>
              <View
                style={[
                  styles.circle,
                  detected ? styles.circleDetected : styles.circleInterpolated,
                  current && styles.circleCurrent,
                ]}
              />
              <Text
                style={[
                  styles.label,
                  detected ? styles.labelDetected : styles.labelInterpolated,
                  current && styles.labelCurrent,
                ]}
                numberOfLines={1}
              >
                {PHASE_LABELS[phase]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default memo(PhaseTimeline);

const styles = StyleSheet.create({
  track: {
    marginTop: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  line: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 14,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 1,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  dotWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    zIndex: 2,
  },
  circle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2.5,
  },
  circleDetected: {
    backgroundColor: '#8971EA',
    borderColor: '#8971EA',
  },
  circleInterpolated: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.55)',
    borderStyle: 'dashed',
    opacity: 0.75,
  },
  circleCurrent: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderStyle: 'solid',
    backgroundColor: '#FFD166',
    borderColor: '#FFFFFF',
    opacity: 1,
    transform: [{ scale: 1.08 }],
  },
  label: {
    fontSize: 8.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  labelDetected: {
    color: 'rgba(255,255,255,0.92)',
  },
  labelInterpolated: {
    color: 'rgba(255,255,255,0.55)',
  },
  labelCurrent: {
    color: '#FFD166',
    fontWeight: '900',
  },
});
