/**
 * 촬영 각도별 지표 신뢰도 배지 (알파 검증 전 임시 기준).
 * 계산 로직은 정면/측면 동일 — UI에만 "참고용"을 차등 표시.
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
 * | 체중이동 | 정상 | 참고용 |
 * | 헤드업 | 정상 | 정상 |
 * | 손목 코킹 | 참고용 | 참고용 |
 * | 관절각도 5개 | 정상 | 참고용 |
 * | 구간분할 | 정상 | 정상 |
 */
export function shouldShowReferenceBadge(
  metric: ReliabilityMetric,
  cameraAngle: CameraAngle | null | undefined,
): boolean {
  const angle = cameraAngle ?? 'unknown';

  switch (metric) {
    case 'wristCocking':
      return true;
    case 'weightShift':
    case 'jointAngles':
      // 측면만 참고용 (검증 전). unknown은 차등 미적용.
      return angle === 'side';
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
