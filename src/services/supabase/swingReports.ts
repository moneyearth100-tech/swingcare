/**
 * Supabase swing_reports upsert — 세션 동기화 성공 후 밸런스 지수·인사이트 저장.
 */

import type { BalanceScoreResult } from '../../features/swing-capture/lib/scoring/balanceScore';
import {
  BALANCE_SCORE_JOINTS,
  type BalanceScoreJoint,
} from '../../features/swing-capture/lib/scoring/balanceScoreConstants';
import type { MovementMetrics } from '../../features/swing-capture/lib/scoring/movementMetrics';

import { getSupabaseClient, isSupabaseConfigured } from './client';

/** v1은 3키, v2+는 5키 — 읽기 시 optional */
export type SwingReportJointScores = Partial<
  Record<BalanceScoreJoint, number>
> & {
  lower_back?: number;
  wrist?: number;
  knee?: number;
  shoulder?: number;
  hip?: number;
};

export interface SwingReportRow {
  id?: string;
  session_id: string;
  user_id: string;
  overall_score: number;
  joint_scores: SwingReportJointScores;
  issue_phase: string | null;
  diagnosis_text: string | null;
  recommended_drill_id: string | null;
  scoring_version: string;
  movement_metrics?: MovementMetrics | null;
  created_at?: string;
}

export type UpsertSwingReportResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'error'; message: string };

function toJointScores(result: BalanceScoreResult): SwingReportJointScores {
  const scores: SwingReportJointScores = {};
  for (const joint of BALANCE_SCORE_JOINTS) {
    scores[joint] = result.joints[joint].score;
  }
  return scores;
}

export async function upsertSwingReport(input: {
  sessionId: string;
  userId: string;
  balanceScore: BalanceScoreResult;
  issuePhase?: string | null;
  diagnosisText?: string | null;
  recommendedDrillId?: string | null;
}): Promise<UpsertSwingReportResult> {
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

  const row: SwingReportRow = {
    session_id: input.sessionId,
    user_id: input.userId,
    overall_score: input.balanceScore.overallScore,
    joint_scores: toJointScores(input.balanceScore),
    issue_phase: input.issuePhase ?? null,
    diagnosis_text: input.diagnosisText ?? null,
    recommended_drill_id: input.recommendedDrillId ?? null,
    scoring_version: input.balanceScore.version,
    movement_metrics: input.balanceScore.movementMetrics,
  };

  const { error } = await supabase
    .from('swing_reports')
    .upsert(row, { onConflict: 'session_id' });

  if (error) {
    console.warn(
      '[upsertSwingReport]',
      error.code,
      error.message,
      error.details,
    );
    return { ok: false, reason: 'error', message: error.message };
  }
  return { ok: true };
}

export async function fetchSwingReportBySessionId(
  sessionId: string,
): Promise<SwingReportRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('swing_reports')
    .select(
      'id, session_id, user_id, overall_score, joint_scores, issue_phase, diagnosis_text, recommended_drill_id, scoring_version, movement_metrics, created_at',
    )
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn('[fetchSwingReport]', error.message);
    }
    return null;
  }
  return data as SwingReportRow;
}
