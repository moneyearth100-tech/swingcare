/**
 * 업로드 스윙 재생용 — Storage signed URL + 세션 frames 조회.
 */

import type { LandmarkFrame, PhaseMarker } from '../../features/swing-capture/lib/landmarkTypes';

import { getSupabaseClient, isSupabaseConfigured } from './client';

const BUCKET = 'swing-uploads';

export type SwingPlaybackSession = {
  id: string;
  status: string;
  captureMode: 'live' | 'upload' | string | null;
  videoUrl: string | null;
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
  durationMs: number;
  fps: number;
};

/** `swing-uploads/{userId}/{file}` → storage path */
export function storagePathFromVideoUrl(videoUrl: string): {
  bucket: string;
  path: string;
} {
  const trimmed = videoUrl.replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');
  if (slash <= 0) {
    throw new Error(`Invalid video_url: ${videoUrl}`);
  }
  return {
    bucket: trimmed.slice(0, slash),
    path: trimmed.slice(slash + 1),
  };
}

export async function createSwingVideoSignedUrl(
  videoUrl: string,
  expiresInSec = 3600,
): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { bucket, path } = storagePathFromVideoUrl(videoUrl);
  const { data, error } = await supabase.storage
    .from(bucket || BUCKET)
    .createSignedUrl(path, expiresInSec);

  if (error || !data?.signedUrl) {
    console.warn('[createSwingVideoSignedUrl]', error?.message);
    return null;
  }
  return data.signedUrl;
}

export async function fetchSwingSessionVideoMeta(
  sessionId: string,
): Promise<{
  videoUrl: string | null;
  thumbnailUrl: string | null;
  captureMode: 'live' | 'upload' | string | null;
  status: string;
  cameraAngle: 'front' | 'side' | 'unknown' | null;
  /** 랜드마크 프레임 존재 — 실시간(영상 없음) 리뷰용 */
  hasFrames: boolean;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  let { data, error } = await supabase
    .from('swing_sessions')
    .select('video_url, thumbnail_url, capture_mode, status, camera_angle')
    .eq('id', sessionId)
    .maybeSingle();

  // thumbnail_url은 선택 기능이다. 016 마이그레이션 적용 전 환경에서도
  // 기존 video_url 조회까지 함께 실패해 영상 카드가 사라지지 않게 폴백한다.
  if (error?.code === '42703' || error?.message.includes('thumbnail_url')) {
    const legacyResult = await supabase
      .from('swing_sessions')
      .select('video_url, capture_mode, status, camera_angle')
      .eq('id', sessionId)
      .maybeSingle();
    data = legacyResult.data
      ? { ...legacyResult.data, thumbnail_url: null }
      : null;
    error = legacyResult.error;
  }

  if (
    error &&
    (error.code === '42703' || error.message.includes('camera_angle'))
  ) {
    const noAngle = await supabase
      .from('swing_sessions')
      .select('video_url, thumbnail_url, capture_mode, status')
      .eq('id', sessionId)
      .maybeSingle();
    data = noAngle.data
      ? { ...noAngle.data, camera_angle: null }
      : null;
    error = noAngle.error;
  }

  if (error || !data) {
    if (error) {
      console.warn('[fetchSwingSessionVideoMeta]', error.message);
    }
    return null;
  }

  const videoUrl = data.video_url ?? null;
  const thumbnailUrl = data.thumbnail_url ?? null;
  const captureMode = data.capture_mode ?? null;
  const hasFrames = Boolean(videoUrl) || captureMode === 'live';
  const rawAngle = (data as { camera_angle?: string | null }).camera_angle;
  const cameraAngle =
    rawAngle === 'front' || rawAngle === 'side' || rawAngle === 'unknown'
      ? rawAngle
      : null;

  return {
    videoUrl,
    thumbnailUrl,
    captureMode,
    status: data.status ?? 'done',
    cameraAngle,
    hasFrames,
  };
}

export async function fetchSwingPlaybackSession(
  sessionId: string,
): Promise<SwingPlaybackSession | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('swing_sessions')
    .select(
      'id, status, capture_mode, video_url, frames, phases, phases_verified, duration_ms, fps',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn('[fetchSwingPlaybackSession]', error.message);
    }
    return null;
  }

  const autoPhases = Array.isArray(data.phases)
    ? (data.phases as PhaseMarker[])
    : [];
  const verified = Array.isArray(data.phases_verified)
    ? (data.phases_verified as PhaseMarker[])
    : [];

  return {
    id: data.id,
    status: data.status,
    captureMode: data.capture_mode ?? null,
    videoUrl: data.video_url ?? null,
    frames: Array.isArray(data.frames) ? (data.frames as LandmarkFrame[]) : [],
    phases: verified.length > 0 ? verified : autoPhases,
    durationMs: Number(data.duration_ms) || 0,
    fps: Number(data.fps) || 0,
  };
}

/** 재생 시각(ms)에 가장 가까운 프레임 인덱스 */
export function nearestFrameIndex(
  frames: readonly LandmarkFrame[],
  timeMs: number,
): number {
  if (frames.length === 0) {
    return -1;
  }
  if (timeMs <= frames[0].timestampMs) {
    return 0;
  }
  const lastIndex = frames.length - 1;
  if (timeMs >= frames[lastIndex].timestampMs) {
    return lastIndex;
  }

  // 프레임은 timestampMs 오름차순으로 저장된다. 매 재생 tick마다 전체 배열을
  // 순회하지 않고 playhead를 감싸는 두 프레임만 찾는다.
  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].timestampMs <= timeMs) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return timeMs - frames[low].timestampMs <= frames[high].timestampMs - timeMs
    ? low
    : high;
}
