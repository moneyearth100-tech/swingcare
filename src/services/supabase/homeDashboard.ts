/**
 * 홈 탭 대시보드: 최근 리포트 · 히어로 · 추천 드릴 · 챌린지 배너.
 */

import {
  SCORE_BAND_CAUTION,
  SCORE_BAND_GOOD,
} from '../../features/swing-capture/lib/scoring/balanceScoreConstants';

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';
import { fetchDrillById, type DrillRow } from './drills';
import type { SwingReportJointScores, SwingReportRow } from './swingReports';

export type HomeRecentReport = {
  id: string;
  sessionId: string;
  title: string;
  meta: string;
  tag: string;
  tagColor: string;
  overallScore: number;
};

export type HomeChallengeBanner = {
  challengeId: string;
  title: string;
  progress: number;
  goalCount: number;
  progressLabel: string;
  meta: string;
  completed: boolean;
};

export type HomeDashboard = {
  overallScore: number | null;
  statusLabel: string;
  statusTone: 'good' | 'caution' | 'warn' | 'empty';
  heroDesc: string;
  joints: {
    label: string;
    value: number | null;
    warn: boolean;
  }[];
  recentReports: HomeRecentReport[];
  drill: DrillRow | null;
  drillFallback: string | null;
  challenge: HomeChallengeBanner | null;
};

const PHASE_TAG: Record<string, string> = {
  address: 'Address',
  toe_up: 'Toe Up',
  mid_backswing: 'Backswing',
  top: 'Top',
  mid_downswing: 'Downswing',
  impact: 'Impact',
  mid_follow_through: 'Follow',
  finish: 'Finish',
};

function formatDateShortKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('month')}.${get('day')}`;
}

function scoreStatus(score: number): {
  label: string;
  tone: 'good' | 'caution' | 'warn';
} {
  if (score >= SCORE_BAND_GOOD) {
    return { label: 'GOOD STANDING', tone: 'good' };
  }
  if (score >= SCORE_BAND_CAUTION) {
    return { label: 'NEEDS FOCUS', tone: 'caution' };
  }
  return { label: 'CHECK FORM', tone: 'warn' };
}

function jointWarn(value: number): boolean {
  return value < SCORE_BAND_CAUTION;
}

function parseJoints(
  jointScores: SwingReportJointScores | null | undefined,
): HomeDashboard['joints'] {
  const lb = jointScores?.lower_back;
  const wrist = jointScores?.wrist;
  const knee = jointScores?.knee;
  return [
    {
      label: '허리',
      value: typeof lb === 'number' ? Math.round(lb) : null,
      warn: typeof lb === 'number' ? jointWarn(lb) : false,
    },
    {
      label: '손목',
      value: typeof wrist === 'number' ? Math.round(wrist) : null,
      warn: typeof wrist === 'number' ? jointWarn(wrist) : false,
    },
    {
      label: '무릎',
      value: typeof knee === 'number' ? Math.round(knee) : null,
      warn: typeof knee === 'number' ? jointWarn(knee) : false,
    },
  ];
}

const EMPTY: HomeDashboard = {
  overallScore: null,
  statusLabel: 'NO REPORT YET',
  statusTone: 'empty',
  heroDesc:
    '아직 스윙 리포트가 없어요.\n실시간 촬영이나 영상 업로드로 시작해 보세요.',
  joints: [
    { label: '허리', value: null, warn: false },
    { label: '손목', value: null, warn: false },
    { label: '무릎', value: null, warn: false },
  ],
  recentReports: [],
  drill: null,
  drillFallback: '리포트가 쌓이면 맞춤 드릴을 추천해 드려요.',
  challenge: null,
};

export async function fetchHomeDashboard(): Promise<HomeDashboard> {
  if (!isSupabaseConfigured()) {
    return EMPTY;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return EMPTY;
  }

  await ensureAnonymousUserId();

  const { data: reports, error: reportError } = await supabase
    .from('swing_reports')
    .select(
      'id, session_id, user_id, overall_score, joint_scores, issue_phase, diagnosis_text, recommended_drill_id, scoring_version, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(3);

  if (reportError) {
    console.warn('[fetchHomeDashboard] reports', reportError.message);
  }

  const rows = (reports ?? []) as SwingReportRow[];
  if (rows.length === 0) {
    const challengeOnly = await fetchChallengeBanner(supabase);
    return { ...EMPTY, challenge: challengeOnly };
  }

  const latest = rows[0];
  const score = Number(latest.overall_score);
  const status = scoreStatus(score);
  const heroDesc =
    latest.diagnosis_text?.trim() ||
    '최근 스윙 밸런스를 확인해 보세요.';

  const recentReports: HomeRecentReport[] = rows.map((r, index) => {
    const createdAt = r.created_at ?? new Date().toISOString();
    const phaseKey = r.issue_phase ?? '';
    const phaseLabel = PHASE_TAG[phaseKey] ?? 'Swing';
    const title =
      r.diagnosis_text?.split('.')[0]?.trim() ||
      `종합 ${Math.round(Number(r.overall_score))}점`;
    return {
      id: r.id ?? r.session_id,
      sessionId: r.session_id,
      title,
      meta: `${formatDateShortKst(createdAt)} · 종합 ${Math.round(Number(r.overall_score))}점`,
      tag: `${phaseLabel}`,
      tagColor: index === 0 ? '#FF758C' : '#3FBF8F',
      overallScore: Number(r.overall_score),
    };
  });

  let drill: DrillRow | null = null;
  let drillFallback: string | null = null;
  if (latest.recommended_drill_id) {
    drill = await fetchDrillById(latest.recommended_drill_id);
    if (!drill) {
      drillFallback =
        '추천 드릴을 불러오지 못했어요. 리포트 상세에서 다시 확인해 주세요.';
    }
  } else {
    drillFallback = '이번 리포트에는 추천 드릴이 없어요.';
  }

  const challenge = await fetchChallengeBanner(supabase);

  return {
    overallScore: Math.round(score),
    statusLabel: status.label,
    statusTone: status.tone,
    heroDesc,
    joints: parseJoints(latest.joint_scores as SwingReportJointScores),
    recentReports,
    drill,
    drillFallback,
    challenge,
  };
}

async function fetchChallengeBanner(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
): Promise<HomeChallengeBanner | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return null;
  }

  const { data: mine, error } = await supabase
    .from('user_challenges')
    .select('id, challenge_id, progress, completed_at, joined_at')
    .eq('user_id', user.id)
    .is('completed_at', null)
    .order('joined_at', { ascending: false })
    .limit(8);

  if (error) {
    console.warn('[fetchHomeDashboard] challenges', error.message);
  }

  const activeMine = mine ?? [];
  if (activeMine.length > 0) {
    const ids = activeMine.map((r) => r.challenge_id);
    const { data: challenges } = await supabase
      .from('challenges')
      .select('id, title, goal_count, is_active, type')
      .in('id', ids)
      .eq('is_active', true)
      .eq('type', 'mission');

    const byId = new Map(
      (challenges ?? []).map((c) => [c.id as string, c]),
    );
    for (const row of activeMine) {
      const ch = byId.get(row.challenge_id);
      if (!ch) {
        continue;
      }
      const goal = Number(ch.goal_count) || 1;
      const progress = row.progress ?? 0;
      const left = Math.max(0, goal - progress);
      return {
        challengeId: ch.id,
        title: ch.title,
        progress,
        goalCount: goal,
        progressLabel: `${progress}/${goal}`,
        meta:
          left > 0
            ? `${left}회 남았어요 — 계속 이어가볼까요?`
            : '목표에 거의 도달했어요',
        completed: false,
      };
    }
  }

  const { data: open } = await supabase
    .from('challenges')
    .select('id, title, goal_count')
    .eq('type', 'mission')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!open) {
    return null;
  }

  return {
    challengeId: open.id,
    title: open.title,
    progress: 0,
    goalCount: open.goal_count,
    progressLabel: `0/${open.goal_count}`,
    meta: '챌린지 탭에서 참여를 시작해 보세요',
    completed: false,
  };
}
