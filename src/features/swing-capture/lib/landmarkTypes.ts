/** MediaPipe BlazePose 33키포인트 및 스윙 세션 핵심 타입 정의 */

/** 단일 키포인트 (정규화 좌표 0~1) */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** BlazePose 표준 33포인트 이름 (index 순서와 동일) */
export const BLAZEPOSE_LANDMARK_NAMES = [
  'nose',
  'left_eye_inner',
  'left_eye',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye',
  'right_eye_outer',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
] as const;

export type LandmarkName = (typeof BLAZEPOSE_LANDMARK_NAMES)[number];

export const BLAZEPOSE_LANDMARK_COUNT = BLAZEPOSE_LANDMARK_NAMES.length; // 33

export const LANDMARK_INDEX: Record<LandmarkName, number> = Object.fromEntries(
  BLAZEPOSE_LANDMARK_NAMES.map((name, index) => [name, index]),
) as Record<LandmarkName, number>;

/**
 * 한 프레임의 포즈 랜드마크.
 * BlazePose 규격상 길이 33을 목표로 하되, `@thinksys/react-native-mediapipe`가
 * body-part props에 따라 부분만 반환할 수 있어 Partial 맵도 허용한다.
 * 실제 콜백 형태는 Step 2(usePoseLandmarks)에서 실기기 로그로 확정한다.
 */
export type PoseLandmarks = Landmark[];

/** 이름 기반 접근이 필요할 때 사용하는 부분 맵 */
export type PoseLandmarkMap = Partial<Record<LandmarkName, Landmark>>;

/** 녹화 시작 기준 상대시간이 붙은 한 프레임 */
export interface LandmarkFrame {
  timestampMs: number;
  landmarks: PoseLandmarks;
}

/** GolfDB/SwingNet 표준 8단계 스윙 구간 */
export type SwingPhase =
  | 'address'
  | 'toe_up'
  | 'mid_backswing'
  | 'top'
  | 'mid_downswing'
  | 'impact'
  | 'mid_follow_through'
  | 'finish';

export const SWING_PHASES: readonly SwingPhase[] = [
  'address',
  'toe_up',
  'mid_backswing',
  'top',
  'mid_downswing',
  'impact',
  'mid_follow_through',
  'finish',
] as const;

/**
 * 구간 마커 — detected(규칙 탐지) vs interpolated(앵커 사이 보간).
 *
 * 관리자 재태깅:
 *   - DB `phases` = AI/규칙 원본 (유지)
 *   - DB `phases_verified` = 사람 수정본 (nullable)
 *   - 앱/채점: `effectivePhases(phases_verified, phases)` = verified ?? 원본
 *   - 도구: tools/admin-phase-retag/
 */
export interface PhaseMarker {
  phase: SwingPhase;
  timestampMs: number;
  frameIndex: number;
  source: 'detected' | 'interpolated' | 'manual';
}

/** 검수본이 있으면 우선, 없으면 AI 원본 */
export function effectivePhases(
  phases: readonly PhaseMarker[] | null | undefined,
  phasesVerified?: readonly PhaseMarker[] | null,
): PhaseMarker[] {
  if (phasesVerified != null && phasesVerified.length > 0) {
    return [...phasesVerified];
  }
  return phases != null ? [...phases] : [];
}

/** 로컬/원격에 저장하는 스윙 세션 (랜드마크 좌표만, 영상 픽셀 미포함) */
export type CameraAngle = 'front' | 'side' | 'unknown';

export interface SwingSession {
  id: string;
  /** Supabase auth.users.id (익명 로그인 포함). 로컬만 있을 때는 null */
  userId: string | null;
  createdAt: string;
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
  durationMs: number;
  deviceInfo: { platform: 'ios' | 'android'; fps: number };
  /**
   * 촬영 각도. front=정면(마주보기), side=예약(후면 후보), unknown=미확인.
   * 1폰 가이드 준수 저장 시 front.
   */
  cameraAngle?: CameraAngle;
}
