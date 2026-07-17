/** 스켈레톤 SharedValue용 flat pose 좌표 패킹 (뷰 픽셀 좌표) */

import { Platform } from 'react-native';

import { BLAZEPOSE_LANDMARK_COUNT } from './landmarkTypes';
import {
  mapNormalizedToView,
  type CoverAlign,
} from './mapLandmarkToView';

/** packed: [viewX, viewY, visibility] * 33 — 이미 뷰 픽셀로 변환된 값 */
export type PackedPosePoints = number[];

export function createEmptyPackedPosePoints(): PackedPosePoints {
  return new Array(BLAZEPOSE_LANDMARK_COUNT * 3).fill(0);
}

export interface PackPosePointsOptions {
  viewWidth: number;
  viewHeight: number;
  imageWidth: number;
  imageHeight: number;
  /** 기본: Android start / iOS stretch. 리뷰 cover 영상은 center 권장 */
  align?: CoverAlign;
}

/**
 * 표시용 패킹. Android는 cover+start, iOS는 stretch(기존에 맞던 방식).
 */
export function packPosePoints(
  landmarks: { x: number; y: number; visibility: number }[],
  options: PackPosePointsOptions,
): PackedPosePoints {
  const packed = createEmptyPackedPosePoints();
  const count = Math.min(landmarks.length, BLAZEPOSE_LANDMARK_COUNT);
  const align =
    options.align ??
    (Platform.OS === 'android' ? 'start' : 'stretch');

  for (let i = 0; i < count; i += 1) {
    const point = landmarks[i];
    const mapped = mapNormalizedToView(
      point.x,
      point.y,
      options.viewWidth,
      options.viewHeight,
      options.imageWidth,
      options.imageHeight,
      align,
    );
    const offset = i * 3;
    packed[offset] = mapped.x;
    packed[offset + 1] = mapped.y;
    packed[offset + 2] = point.visibility;
  }
  return packed;
}
