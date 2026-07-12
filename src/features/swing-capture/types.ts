/** swing-capture 모듈 UI·도메인 보조 타입 */

import type { LandmarkFrame, PhaseMarker, SwingSession } from './lib/landmarkTypes';

export type { LandmarkFrame, PhaseMarker, SwingSession };

/** 목업 클럽 타입 chips (드라이버/아이언/퍼팅) */
export type ClubType = 'driver' | 'iron' | 'putting';

/** SwingCaptureScreen 세그먼트: 실시간 촬영 | 영상 업로드 */
export type CaptureSegment = 'live' | 'upload';

/** 포즈 인식 상태 (캡처 화면 칩/배너용) */
export type PoseDetectionStatus = 'detecting' | 'detected' | 'lost';

/** 업로드 탭 최근 파일 목록 UI용 */
export interface RecentUploadItem {
  id: string;
  name: string;
  meta: string;
}

/** 세션 동기화 상태 */
export type SessionSyncStatus = 'local_only' | 'syncing' | 'synced' | 'failed';
