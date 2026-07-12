import {
  computeBalanceScore,
} from '../../src/features/swing-capture/lib/scoring/balanceScore.ts';
import {
  matchDiagnosis,
} from '../../src/features/swing-capture/lib/scoring/diagnosisTemplates.ts';
import {
  segmentSwingPhases,
} from '../../src/features/swing-capture/lib/phaseSegmentation.ts';

import type { AnalyzeJobData } from './queue.js';
import {
  downloadVideoToBuffer,
  fetchSession,
  saveAnalysisResult,
  setSessionStatus,
} from './supabaseAdmin.js';
import { callVisionExtract } from './visionClient.js';

function msSince(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return null;
  }
  return Date.now() - t;
}

/**
 * Full upload analysis pipeline for one session.
 * Timing logs feed future "분석 중..." ETA UI.
 */
export async function analyzeUploadSession(
  data: AnalyzeJobData,
): Promise<void> {
  const t0 = Date.now();
  const session = await fetchSession(data.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${data.sessionId}`);
  }
  if (!session.video_url) {
    throw new Error('Session has no video_url');
  }

  const pendingAgeMs =
    msSince(data.pendingSince ?? session.created_at) ?? undefined;

  console.log(
    `[analyze] start session=${data.sessionId} status=${session.status} pending_age_ms=${pendingAgeMs ?? 'n/a'}`,
  );

  if (session.status === 'done') {
    console.log(`[analyze] skip already done session=${data.sessionId}`);
    return;
  }

  await setSessionStatus(data.sessionId, 'processing', null);

  let downloadMs = 0;
  let extractMs = 0;
  let scoreMs = 0;

  try {
    const tDownload = Date.now();
    const { buffer, fileName, contentType } = await downloadVideoToBuffer(
      session.video_url,
    );
    downloadMs = Date.now() - tDownload;

    const tExtract = Date.now();
    const vision = await callVisionExtract(buffer, fileName, contentType);
    extractMs = Date.now() - tExtract;

    const tScore = Date.now();
    const frames = vision.frames;
    const { phases } = segmentSwingPhases(frames);
    const balanceScore = computeBalanceScore(frames, phases);
    const diagnosis = matchDiagnosis(balanceScore, phases);
    scoreMs = Date.now() - tScore;

    await saveAnalysisResult({
      sessionId: session.id,
      userId: session.user_id,
      frames,
      phases,
      durationMs: vision.durationMs,
      fps: vision.fps,
      overallScore: balanceScore.overallScore,
      jointScores: {
        lower_back: balanceScore.joints.lower_back.score,
        wrist: balanceScore.joints.wrist.score,
        knee: balanceScore.joints.knee.score,
      },
      issuePhase: diagnosis.issuePhase,
      diagnosisText: diagnosis.template.body,
      recommendedDrillId: diagnosis.template.recommendedDrillId,
      scoringVersion: balanceScore.version,
    });

    const totalMs = Date.now() - t0;
    console.log(
      `[analyze] done session=${data.sessionId} ` +
        `pending_age_ms=${pendingAgeMs ?? 'n/a'} ` +
        `download_ms=${downloadMs} extract_ms=${extractMs} score_ms=${scoreMs} ` +
        `total_ms=${totalMs} frames=${vision.frameCount} ` +
        `overall=${balanceScore.overallScore} pattern=${diagnosis.patternId}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[analyze] fail session=${data.sessionId} ` +
        `pending_age_ms=${pendingAgeMs ?? 'n/a'} ` +
        `download_ms=${downloadMs} extract_ms=${extractMs} score_ms=${scoreMs} ` +
        `elapsed_ms=${Date.now() - t0} error=${message}`,
    );
    throw error;
  }
}

export async function markSessionAnalysisError(
  sessionId: string,
  message: string,
): Promise<void> {
  await setSessionStatus(sessionId, 'error', message.slice(0, 2000));
}
