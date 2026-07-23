/**
 * 리포트 탭 피드: pending 업로드 세션 + 완료 리포트.
 * (챌린지 도메인과 분리)
 */

import { getSupabaseClient, isSupabaseConfigured, ensureAnonymousUserId } from './client';
import { parseDiagnosisText } from '../../features/swing-capture/lib/scoring/diagnosisTemplates';
import { resolvePlayableLocalVideoUri } from '../../features/swing-capture/lib/localSwingVideo';
import {
  getStoredSwingSessionsSnapshot,
  hydrateSwingSessionStore,
} from '../../features/swing-capture/store/swingSessionStore';
import type { SwingReportRow } from './swingReports';

export type ReportFeedItem =
  | {
      kind: 'pending';
      id: string;
      sessionId: string;
      createdAt: string;
      title: string;
      meta: string;
      tag: string;
      tagColor: string;
      status: 'pending' | 'processing';
      hasVideo: boolean;
    }
  | {
      kind: 'error';
      id: string;
      sessionId: string;
      createdAt: string;
      title: string;
      meta: string;
      tag: string;
      tagColor: string;
      hasVideo: boolean;
    }
  | {
      kind: 'report';
      id: string;
      sessionId: string;
      createdAt: string;
      title: string;
      meta: string;
      tag: string;
      tagColor: string;
      overallScore: number;
      hasVideo: boolean;
    };

/** KST 년.월.일 시:분:초 — 피드에서 방금 건 구분용 */
function formatDateKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

export async function fetchReportFeed(limit = 30): Promise<ReportFeedItem[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  await ensureAnonymousUserId();
  await hydrateSwingSessionStore();
  const localVideoBySession = new Map<string, boolean>();
  for (const stored of getStoredSwingSessionsSnapshot()) {
    localVideoBySession.set(
      stored.id,
      Boolean(resolvePlayableLocalVideoUri(stored.id, stored.localVideoUri)),
    );
  }
  const sessionHasPlayableVideo = (
    sessionId: string,
    remoteVideoUrl: string | null | undefined,
  ): boolean =>
    Boolean(remoteVideoUrl) || localVideoBySession.get(sessionId) === true;

  const { data: pendingSessions, error: pendingError } = await supabase
    .from('swing_sessions')
    .select('id, created_at, status, capture_mode, video_url')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (pendingError) {
    console.warn('[fetchReportFeed] pending', pendingError.message);
  }

  const { data: errorSessions, error: errorSessionsError } = await supabase
    .from('swing_sessions')
    .select('id, created_at, status, capture_mode, analysis_error, video_url')
    .eq('status', 'error')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (errorSessionsError) {
    console.warn('[fetchReportFeed] error sessions', errorSessionsError.message);
  }

  const { data: reports, error: reportError } = await supabase
    .from('swing_reports')
    .select(
      'id, session_id, user_id, overall_score, joint_scores, issue_phase, diagnosis_text, recommended_drill_id, scoring_version, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (reportError) {
    console.warn('[fetchReportFeed] reports', reportError.message);
  }

  const items: ReportFeedItem[] = [];

  for (const s of pendingSessions ?? []) {
    const status =
      s.status === 'processing' ? ('processing' as const) : ('pending' as const);
    items.push({
      kind: 'pending',
      id: `pending-${s.id}`,
      sessionId: s.id,
      createdAt: s.created_at,
      status,
      hasVideo: sessionHasPlayableVideo(s.id, s.video_url),
      tag:
        status === 'processing' ? 'UPLOAD · PROCESSING' : 'UPLOAD · PENDING',
      tagColor: '#E5A85D',
      title: '분석 중...',
      meta:
        status === 'processing'
          ? `${formatDateKst(s.created_at)} · 서버 분석 진행 중`
          : `${formatDateKst(s.created_at)} · 서버 분석 대기`,
    });
  }

  for (const s of errorSessions ?? []) {
    items.push({
      kind: 'error',
      id: `error-${s.id}`,
      sessionId: s.id,
      createdAt: s.created_at,
      hasVideo: sessionHasPlayableVideo(s.id, s.video_url),
      tag: 'UPLOAD · ERROR',
      tagColor: '#E57373',
      title: '분석 실패',
      meta: `${formatDateKst(s.created_at)} · 다시 업로드해 주세요`,
    });
  }

  const reportRows = (reports ?? []) as SwingReportRow[];
  const reportSessionIds = reportRows.map((r) => r.session_id);
  const videoBySession = new Map<string, boolean>();
  if (reportSessionIds.length > 0) {
    const { data: sessionRows, error: sessionError } = await supabase
      .from('swing_sessions')
      .select('id, video_url')
      .in('id', reportSessionIds);
    if (sessionError) {
      console.warn('[fetchReportFeed] sessions video', sessionError.message);
    }
    for (const s of sessionRows ?? []) {
      videoBySession.set(
        s.id,
        sessionHasPlayableVideo(s.id, s.video_url as string | null),
      );
    }
    for (const id of reportSessionIds) {
      if (!videoBySession.has(id)) {
        videoBySession.set(id, sessionHasPlayableVideo(id, null));
      }
    }
  }

  for (const r of reportRows) {
    const createdAt = r.created_at ?? new Date().toISOString();
    const parsed = parseDiagnosisText(r.diagnosis_text);
    const title =
      parsed.summary ||
      `종합 ${Math.round(r.overall_score)}점`;
    items.push({
      kind: 'report',
      id: r.id ?? r.session_id,
      sessionId: r.session_id,
      createdAt,
      hasVideo: videoBySession.get(r.session_id) === true,
      tag: 'REPORT',
      tagColor: '#FF758C',
      title,
      meta: `${formatDateKst(createdAt)} · 종합 ${Math.round(r.overall_score)}점`,
      overallScore: r.overall_score,
    });
  }

  items.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return items.slice(0, limit);
}
