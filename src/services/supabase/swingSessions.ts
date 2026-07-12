/**
 * Supabase swing_sessions 테이블 read/write.
 * RLS: authenticated + auth.uid() = user_id (익명 로그인 포함).
 */

import type {
  CameraAngle,
  LandmarkFrame,
  PhaseMarker,
  SwingSession,
} from '../../features/swing-capture/lib/landmarkTypes';

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';

/** DB row ↔ SwingSession 매핑 */
export interface SwingSessionRow {
  id: string;
  user_id: string;
  created_at: string;
  duration_ms: number;
  platform: 'ios' | 'android';
  fps: number;
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
  camera_angle?: CameraAngle;
}

export function toSwingSessionRow(session: SwingSession): SwingSessionRow {
  if (!session.userId) {
    throw new Error('SwingSession.userId is required for remote upsert');
  }
  return {
    id: session.id,
    user_id: session.userId,
    created_at: session.createdAt,
    duration_ms: session.durationMs,
    platform: session.deviceInfo.platform,
    fps: session.deviceInfo.fps,
    frames: session.frames,
    phases: session.phases,
    camera_angle: session.cameraAngle ?? 'unknown',
  };
}

export function fromSwingSessionRow(row: SwingSessionRow): SwingSession {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    durationMs: row.duration_ms,
    frames: row.frames,
    phases: row.phases,
    deviceInfo: {
      platform: row.platform,
      fps: row.fps,
    },
    cameraAngle: row.camera_angle ?? 'unknown',
  };
}

export type UpsertSwingSessionResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_configured' | 'auth' | 'error'; message: string };

/** 세션 upsert (좌표 JSON만, 영상 없음). 익명 로그인 후 user_id 포함. */
export async function upsertSwingSession(
  session: SwingSession,
): Promise<UpsertSwingSessionResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 미설정 (.env 후 Metro 재시작)',
    };
  }

  const userId = session.userId ?? (await ensureAnonymousUserId());
  if (!userId) {
    return {
      ok: false,
      reason: 'auth',
      message: 'anonymous sign-in failed (Dashboard → Anonymous 활성화 확인)',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Supabase client unavailable',
    };
  }

  const row = toSwingSessionRow({ ...session, userId });
  const { error } = await supabase
    .from('swing_sessions')
    .upsert(row, { onConflict: 'id' });

  if (error) {
    console.warn('[upsertSwingSession]', error.code, error.message, error.details);
    return { ok: false, reason: 'error', message: error.message };
  }
  return { ok: true, userId };
}

export async function listRemoteSwingSessions(
  limit = 20,
): Promise<SwingSession[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  await ensureAnonymousUserId();

  const { data, error } = await supabase
    .from('swing_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return (data as SwingSessionRow[]).map(fromSwingSessionRow);
}
