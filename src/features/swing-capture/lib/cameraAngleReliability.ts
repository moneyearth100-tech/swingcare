/**
 * 촬영 각도별 지표 신뢰도 배지.
 * 정면·측면 동일 기능 경로 — 코킹만 참고용(양쪽 공통).
 */

import type { CameraAngle } from './landmarkTypes';

export type ReliabilityMetric =
  | 'weightShift'
  | 'headRise'
  | 'wristCocking'
  | 'jointAngles'
  | 'phases';

/**
 * | 지표 | 정면 | 측면 |
 * | 체중이동 | 정상 | 정상 |
 * | 헤드업 | 정상 | 정상 |
 * | 손목 코킹 | 참고용 | 참고용 |
 * | 관절각도 5개 | 정상 | 정상 |
 * | 구간분할 | 정상 | 정상 |
 */
export function shouldShowReferenceBadge(
  metric: ReliabilityMetric,
  _cameraAngle: CameraAngle | null | undefined,
): boolean {
  switch (metric) {
    case 'wristCocking':
      return true;
    case 'weightShift':
    case 'jointAngles':
    case 'headRise':
    case 'phases':
      return false;
    default:
      return false;
  }
}

export function cameraAngleLabelKo(
  cameraAngle: CameraAngle | null | undefined,
): string {
  switch (cameraAngle) {
    case 'front':
      return '정면';
    case 'side':
      return '측면';
    default:
      return '미확인';
  }
}
