import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { assertWorkerEnv, config } from './config.js';

let admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (!admin) {
    assertWorkerEnv();
    admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export type UploadSessionRow = {
  id: string;
  user_id: string;
  video_url: string | null;
  status: string;
  created_at: string;
  capture_mode: string | null;
};

/** video_url format: `swing-uploads/{userId}/{sessionId}.ext` */
export function parseVideoUrl(videoUrl: string): {
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

export async function fetchSession(
  sessionId: string,
): Promise<UploadSessionRow | null> {
  const { data, error } = await getAdminClient()
    .from('swing_sessions')
    .select('id, user_id, video_url, status, created_at, capture_mode')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data as UploadSessionRow | null;
}

export async function listPendingOrStuckSessions(
  limit = 20,
): Promise<UploadSessionRow[]> {
  const { data, error } = await getAdminClient()
    .from('swing_sessions')
    .select('id, user_id, video_url, status, created_at, capture_mode')
    .eq('capture_mode', 'upload')
    .in('status', ['pending'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as UploadSessionRow[];
}

export async function setSessionStatus(
  sessionId: string,
  status: 'pending' | 'processing' | 'done' | 'error',
  analysisError: string | null = null,
): Promise<void> {
  const { error } = await getAdminClient()
    .from('swing_sessions')
    .update({
      status,
      analysis_error: analysisError,
    })
    .eq('id', sessionId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function saveAnalysisResult(input: {
  sessionId: string;
  userId: string;
  frames: unknown;
  phases: unknown;
  durationMs: number;
  fps: number;
  overallScore: number;
  jointScores: { lower_back: number; wrist: number; knee: number };
  issuePhase: string | null;
  diagnosisText: string | null;
  recommendedDrillId: string | null;
  scoringVersion: string;
}): Promise<void> {
  const supabase = getAdminClient();

  const { error: sessionError } = await supabase
    .from('swing_sessions')
    .update({
      frames: input.frames,
      phases: input.phases,
      duration_ms: input.durationMs,
      fps: input.fps,
      status: 'done',
      analysis_error: null,
    })
    .eq('id', input.sessionId);

  if (sessionError) {
    throw new Error(`session update: ${sessionError.message}`);
  }

  const { error: reportError } = await supabase.from('swing_reports').upsert(
    {
      session_id: input.sessionId,
      user_id: input.userId,
      overall_score: input.overallScore,
      joint_scores: input.jointScores,
      issue_phase: input.issuePhase,
      diagnosis_text: input.diagnosisText,
      recommended_drill_id: input.recommendedDrillId,
      scoring_version: input.scoringVersion,
    },
    { onConflict: 'session_id' },
  );

  if (reportError) {
    throw new Error(`report upsert: ${reportError.message}`);
  }
}

export async function downloadVideoToBuffer(
  videoUrl: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const { bucket, path } = parseVideoUrl(videoUrl);
  const { data, error } = await getAdminClient().storage
    .from(bucket)
    .download(path);
  if (error || !data) {
    throw new Error(error?.message ?? 'storage download failed');
  }
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileName = path.split('/').pop() ?? 'swing.mp4';
  const ext = fileName.toLowerCase();
  const contentType = ext.endsWith('.mov')
    ? 'video/quicktime'
    : ext.endsWith('.webm')
      ? 'video/webm'
      : 'video/mp4';
  return { buffer, fileName, contentType };
}
