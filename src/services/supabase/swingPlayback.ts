/**
 * 업로드 스윙 재생용 — Storage signed URL + 세션 frames 조회.
 */

import type { LandmarkFrame, PhaseMarker } from '../../features/swing-capture/lib/landmarkTypes';

import { getSupabaseClient, isSupabaseConfigured } from './client';

const BUCKET = 'swing-uploads';

export type SwingPlaybackSession = {
  id: string;
  status: string;
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
  captureMode: 'live' | 'upload' | string | null;
  status: string;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('swing_sessions')
    .select('video_url, capture_mode, status')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn('[fetchSwingSessionVideoMeta]', error.message);
    }
    return null;
  }

  return {
    videoUrl: data.video_url ?? null,
    captureMode: data.capture_mode ?? null,
    status: data.status ?? 'done',
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
      'id, status, video_url, frames, phases, phases_verified, duration_ms, fps',
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
  let best = 0;
  let bestDist = Math.abs(frames[0].timestampMs - timeMs);
  for (let i = 1; i < frames.length; i += 1) {
    const dist = Math.abs(frames[i].timestampMs - timeMs);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}
