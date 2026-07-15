/**
 * 영상 업로드 → Storage signed URL PUT → swing_sessions(pending).
 *
 * NOTE:
 *   실시간(live)은 MediaPipe 카메라 세션에서 녹화한 원본을
 *   세션 저장 후 attachVideoToSwingSession 으로 연결한다.
 *   업로드(upload)는 생성 시점에 Storage + video_url 을 둔다.
 */

import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type {
  LandmarkFrame,
  PhaseMarker,
} from '../../features/swing-capture/lib/landmarkTypes';
import type { BalanceScoreResult } from '../../features/swing-capture/lib/scoring/balanceScore';
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
      videoUrl: string;
      storagePath: string;
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
 * 기존 세션(주로 live)에 코칭용 원본 영상을 붙인다. capture_mode 는 유지.
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
 * createSignedUploadUrl → PUT(signedUrl) → swing_sessions insert.
 * Android content:// 는 fetch(blob)가 실패하기 쉬워 expo-file-system File.upload 사용.
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
  const uploaded = await putLocalVideoToStorage({
    userId,
    sessionId,
    localUri: input.localUri,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (!uploaded.ok) {
    return {
      ok: false,
      reason: uploaded.reason,
      message: uploaded.message,
    };
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
    video_url: uploaded.videoUrl,
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

  return {
    ok: true,
    sessionId,
    videoUrl: uploaded.videoUrl,
    storagePath: uploaded.storagePath,
  };
}
