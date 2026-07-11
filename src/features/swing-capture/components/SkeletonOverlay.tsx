/** Skia 기반 실시간 스켈레톤(점·선) 오버레이 — SharedValue/worklet 경로 */

import { Canvas, Circle, Group, Line, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { BLAZEPOSE_LANDMARK_COUNT } from '../lib/landmarkTypes';
import type { PackedPosePoints } from '../lib/packedPosePoints';
import { POSE_CONNECTIONS } from '../lib/poseConnections';

export type { PackedPosePoints } from '../lib/packedPosePoints';
export {
  createEmptyPackedPosePoints,
  packPosePoints,
} from '../lib/packedPosePoints';

/** 목업 camera__figure / aurora accent */
const JOINT_COLOR = '#C9B8FF';
const BONE_COLOR = '#8971EA';

const JOINT_RADIUS = 4.5;
const BONE_STROKE = 2.2;
const MIN_VISIBILITY = 0.35;

interface SkeletonOverlayProps {
  pointsSV: SharedValue<PackedPosePoints>;
  width: number;
  height: number;
}

interface BoneProps {
  startIndex: number;
  endIndex: number;
  pointsSV: SharedValue<PackedPosePoints>;
}

function Bone({ startIndex, endIndex, pointsSV }: BoneProps) {
  const p1 = useDerivedValue(() => {
    'worklet';
    const points = pointsSV.value;
    const ox = startIndex * 3;
    return vec(points[ox], points[ox + 1]);
  });

  const p2 = useDerivedValue(() => {
    'worklet';
    const points = pointsSV.value;
    const ox = endIndex * 3;
    return vec(points[ox], points[ox + 1]);
  });

  const opacity = useDerivedValue(() => {
    'worklet';
    const points = pointsSV.value;
    const v1 = points[startIndex * 3 + 2] ?? 0;
    const v2 = points[endIndex * 3 + 2] ?? 0;
    return v1 >= MIN_VISIBILITY && v2 >= MIN_VISIBILITY ? 0.92 : 0;
  });

  return (
    <Line
      p1={p1}
      p2={p2}
      color={BONE_COLOR}
      style="stroke"
      strokeWidth={BONE_STROKE}
      strokeCap="round"
      opacity={opacity}
    />
  );
}

interface JointProps {
  index: number;
  pointsSV: SharedValue<PackedPosePoints>;
}

function Joint({ index, pointsSV }: JointProps) {
  const cx = useDerivedValue(() => {
    'worklet';
    return pointsSV.value[index * 3];
  });

  const cy = useDerivedValue(() => {
    'worklet';
    return pointsSV.value[index * 3 + 1];
  });

  const opacity = useDerivedValue(() => {
    'worklet';
    const visibility = pointsSV.value[index * 3 + 2] ?? 0;
    return visibility >= MIN_VISIBILITY ? 1 : 0;
  });

  return (
    <Circle
      cx={cx}
      cy={cy}
      r={JOINT_RADIUS}
      color={JOINT_COLOR}
      opacity={opacity}
    />
  );
}

/**
 * 표시용 스무딩 랜드마크 SharedValue를 Skia로 그린다.
 * JS 스레드에서는 pointsSV.value 할당만 하고, 좌표 변환·그리기는 worklet/UI 경로.
 */
export default function SkeletonOverlay({
  pointsSV,
  width,
  height,
}: SkeletonOverlayProps) {
  const bones = useMemo(
    () =>
      POSE_CONNECTIONS.map(([startIndex, endIndex]) => (
        <Bone
          key={`bone-${startIndex}-${endIndex}`}
          startIndex={startIndex}
          endIndex={endIndex}
          pointsSV={pointsSV}
        />
      )),
    [pointsSV],
  );

  const joints = useMemo(
    () =>
      Array.from({ length: BLAZEPOSE_LANDMARK_COUNT }, (_, index) => (
        <Joint key={`joint-${index}`} index={index} pointsSV={pointsSV} />
      )),
    [pointsSV],
  );

  if (width <= 0 || height <= 0) {
    return null;
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]} pointerEvents="none">
      <Group>
        {bones}
        {joints}
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
});
