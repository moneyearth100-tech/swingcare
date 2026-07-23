/**
 * 영상 업로드 → Storage signed URL PUT → swing_sessions.
 *
 * NOTE:
 *   실시간(live)·갤러리(upload) 모두 평소에는 로컬 영상만 보관하고
 *   swing_sessions.video_url 은 null 로 둔다.
 *   Storage 업로드(attachVideoToSwingSession)는 코칭 요청 시에만 수행한다.
 */

import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type {
  LandmarkFrame,
  PhaseMarker,
} from '../../features/swing-capture/lib/landmarkTypes';
import { persistLocalSwingVideo } from '../../features/swing-capture/lib/localSwingVideo';
import type { BalanceScoreResult } from '../../features/swing-capture/lib/scoring/balanceScore';
import { rememberSyncedSwingSession } from '../../features/swing-capture/store/swingSessionStore';
import { enqueueSessionAnalyze } from './analyzeEnqueue';
import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';
import { upsertSwingReport } from './swingReports';

const BUCKET = 'swing-uploads';

export type UploadSwingVideoResult =
  | {
      ok: true;
      sessionId: string;
      /** 코칭 업로드 전에는 null */
      videoUrl: string | null;
      storagePath: string | null;
      localVideoUri: string;
    }
  | {
      ok: false;
      reason:
        | 'not_configured'
        | 'auth'
        | 'signed_url'
        | 'put'
        | 'insert'
        | 'report'
        | 'error';
      message: string;
    };

export interface UploadOnDeviceAnalysis {
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
  fps: number;
  durationMs: number;
  balanceScore: BalanceScoreResult;
  issuePhase: string | null;
  diagnosisText: string;
  recommendedDrillId: string;
}

/**
 * swing_sessions.id 는 uuid.
 * expo-crypto 네이티브 모듈에 의존하지 않음 (Dev Client 미포함 시 크래시 방지).
 */
function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    .padEnd(32, '0')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function extensionFromName(name: string, mimeType?: string | null): string {
  const fromName = name.includes('.')
    ? name.slice(name.lastIndexOf('.')).toLowerCase()
    : '';
  if (fromName && fromName.length <= 5) {
    return fromName;
  }
  if (mimeType?.includes('quicktime')) {
    return '.mov';
  }
  if (mimeType?.includes('webm')) {
    return '.webm';
  }
  return '.mp4';
}

async function putLocalVideoToStorage(input: {
  userId: string;
  sessionId: string;
  localUri: string;
  fileName: string;
  mimeType?: string | null;
}): Promise<
  | { ok: true; videoUrl: string; storagePath: string }
  | { ok: false; reason: 'signed_url' | 'put'; message: string }
> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: 'put', message: 'Supabase client unavailable' };
  }

  const ext = extensionFromName(input.fileName, input.mimeType);
  const storagePath = `${input.userId}/${input.sessionId}${ext}`;
  const contentType = input.mimeType || 'video/mp4';

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signError || !signed?.signedUrl) {
    console.warn('[putLocalVideoToStorage] signedUrl', signError?.message);
    return {
      ok: false,
      reason: 'signed_url',
      message: signError?.message ?? 'signed upload URL 발급 실패',
    };
  }

  try {
    const file = new File(input.localUri);
    const uploadResult = await file.upload(signed.signedUrl, {
      httpMethod: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
    });

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      console.warn(
        '[putLocalVideoToStorage] PUT',
        uploadResult.status,
        uploadResult.body,
      );
      return {
        ok: false,
        reason: 'put',
        message: `업로드 실패 (${uploadResult.status})`,
      };
    }
  } catch (e) {
    console.warn('[putLocalVideoToStorage] file.upload', e);
    return {
      ok: false,
      reason: 'put',
      message: e instanceof Error ? e.message : '로컬 영상 업로드 실패',
    };
  }

  return {
    ok: true,
    videoUrl: `${BUCKET}/${storagePath}`,
    storagePath,
  };
}

/**
 * 실시간 녹화 종료 시 카메라 한 컷(JPEG) 업로드 → thumbnail_url.
 */
export async function attachThumbnailToSwingSession(input: {
  sessionId: string;
  localUri: string;
}): Promise<{ ok: true; thumbnailUrl: string } | { ok: false; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Supabase 미설정' };
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: 'Supabase client unavailable' };
  }
  const userId = await ensureAnonymousUserId();
  if (!userId) {
    return { ok: false, message: '로그인(익명 포함)이 필요합니다' };
  }

  const storagePath = `${userId}/${input.sessionId}_thumb.jpg`;
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signError || !signed?.signedUrl) {
    return {
      ok: false,
      message: signError?.message ?? 'signed upload URL 발급 실패',
    };
  }

  try {
    const file = new File(input.localUri);
    const uploadResult = await file.upload(signed.signedUrl, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
    });
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      return {
        ok: false,
        message: `썸네일 업로드 실패 (${uploadResult.status})`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : '썸네일 업로드 실패',
    };
  }

  const thumbnailUrl = `${BUCKET}/${storagePath}`;
  const { error } = await supabase
    .from('swing_sessions')
    .update({ thumbnail_url: thumbnailUrl })
    .eq('id', input.sessionId)
    .eq('user_id', userId);

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true, thumbnailUrl };
}

/**
 * 기존 세션(주로 live)에 코칭용 원본 영상을 Storage에 올린 뒤 video_url 을 붙인다.
 * capture_mode 는 유지.
 */
export async function attachVideoToSwingSession(input: {
  sessionId: string;
  localUri: string;
  fileName: string;
  mimeType?: string | null;
}): Promise<{ ok: true; videoUrl: string } | { ok: false; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Supabase 미설정' };
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: 'Supabase client unavailable' };
  }
  const userId = await ensureAnonymousUserId();
  if (!userId) {
    return { ok: false, message: '로그인(익명 포함)이 필요합니다' };
  }

  const uploaded = await putLocalVideoToStorage({
    userId,
    sessionId: input.sessionId,
    localUri: input.localUri,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (!uploaded.ok) {
    return { ok: false, message: uploaded.message };
  }

  const { error } = await supabase
    .from('swing_sessions')
    .update({
      video_url: uploaded.videoUrl,
    })
    .eq('id', input.sessionId)
    .eq('user_id', userId);

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true, videoUrl: uploaded.videoUrl };
}

/**
 * 코칭 요청 직전: 원격 video_url 이 없으면 로컬 원본을 Storage에 올린다.
 */
export async function ensureSwingSessionVideoUploaded(input: {
  sessionId: string;
  localUri?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<
  | { ok: true; videoUrl: string; uploaded: boolean }
  | { ok: false; message: string }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Supabase 미설정' };
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: 'Supabase client unavailable' };
  }

  const { data, error } = await supabase
    .from('swing_sessions')
    .select('video_url')
    .eq('id', input.sessionId)
    .maybeSingle();
  if (error) {
    return { ok: false, message: error.message };
  }
  const existing = (data?.video_url as string | null | undefined) ?? null;
  if (existing) {
    return { ok: true, videoUrl: existing, uploaded: false };
  }

  const localUri = input.localUri;
  if (!localUri) {
    return { ok: false, message: '코칭용 스윙 영상이 필요해요' };
  }

  const ext =
    input.fileName?.includes('.')
      ? input.fileName.slice(input.fileName.lastIndexOf('.'))
      : localUri.toLowerCase().includes('.mov')
        ? '.mov'
        : '.mp4';
  const attached = await attachVideoToSwingSession({
    sessionId: input.sessionId,
    localUri,
    fileName: input.fileName ?? `swing_${input.sessionId}${ext}`,
    mimeType:
      input.mimeType ??
      (ext === '.mov' ? 'video/quicktime' : 'video/mp4'),
  });
  if (!attached.ok) {
    return { ok: false, message: attached.message };
  }
  return { ok: true, videoUrl: attached.videoUrl, uploaded: true };
}

/**
 * 갤러리 영상: 온디바이스 분석 후 세션+리포트만 동기화.
 * 원본은 로컬 Documents에 보관하고 video_url 은 null (코칭 시 업로드).
 */
export async function uploadSwingVideoAndCreateSession(input: {
  localUri: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationMs: number;
  /** front | side — 업로드 전 선택 UI에서 전달 */
  cameraAngle?: 'front' | 'side' | 'unknown';
  onDeviceAnalysis?: UploadOnDeviceAnalysis;
}): Promise<UploadSwingVideoResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Supabase 미설정',
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

  const userId = await ensureAnonymousUserId();
  if (!userId) {
    return {
      ok: false,
      reason: 'auth',
      message: '로그인(익명 포함)이 필요합니다',
    };
  }

  const sessionId = createSessionId();
  const persisted = persistLocalSwingVideo({
    sessionId,
    sourceUri: input.localUri,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  const localVideoUri = persisted.ok ? persisted.uri : input.localUri;
  if (!persisted.ok) {
    console.warn(
      '[uploadSwingVideo] local persist failed, using source uri',
      persisted.message,
    );
  }

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const analysis = input.onDeviceAnalysis;
  const { error: insertError } = await supabase.from('swing_sessions').insert({
    id: sessionId,
    user_id: userId,
    duration_ms: Math.max(
      0,
      Math.round(analysis?.durationMs ?? input.durationMs),
    ),
    platform,
    fps: analysis?.fps ?? 0,
    frames: analysis?.frames ?? [],
    phases: analysis?.phases ?? [],
    capture_mode: 'upload',
    video_url: null,
    status: analysis ? 'done' : 'pending',
    camera_angle: input.cameraAngle ?? 'unknown',
  });

  if (insertError) {
    console.warn('[uploadSwingVideo] insert', insertError.message);
    return {
      ok: false,
      reason: 'insert',
      message: insertError.message,
    };
  }

  if (analysis) {
    const reportResult = await upsertSwingReport({
      sessionId,
      userId,
      balanceScore: analysis.balanceScore,
      issuePhase: analysis.issuePhase,
      diagnosisText: analysis.diagnosisText,
      recommendedDrillId: analysis.recommendedDrillId,
    });
    if (!reportResult.ok) {
      await supabase
        .from('swing_sessions')
        .update({ status: 'error' })
        .eq('id', sessionId)
        .eq('user_id', userId);
      return {
        ok: false,
        reason: 'report',
        message: `분석 리포트 저장 실패: ${reportResult.message}`,
      };
    }
  } else {
    void enqueueSessionAnalyze(sessionId);
  }

  await rememberSyncedSwingSession({
    session: {
      id: sessionId,
      userId,
      createdAt: new Date().toISOString(),
      frames: analysis?.frames ?? [],
      phases: analysis?.phases ?? [],
      durationMs: Math.max(
        0,
        Math.round(analysis?.durationMs ?? input.durationMs),
      ),
      deviceInfo: { platform, fps: analysis?.fps ?? 0 },
      cameraAngle: input.cameraAngle ?? 'unknown',
    },
    localVideoUri,
  });

  return {
    ok: true,
    sessionId,
    videoUrl: null,
    storagePath: null,
    localVideoUri,
  };
}
