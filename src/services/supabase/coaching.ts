/**
 * 코칭 마켓 클라이언트 — extract / assign / send + 목록 조회.
 */

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';

function analyzeBaseUrl(): string {
  const base = (process.env.EXPO_PUBLIC_ANALYZE_API_URL ?? '').replace(/\/$/, '');
  // Android release builds commonly reject cleartext HTTP, and LAN addresses
  // embedded at build time are not reliably reachable from the installed APK.
  if (!__DEV__ && base && !base.toLowerCase().startsWith('https://')) {
    return '';
  }
  return base;
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {};
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type CoachRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  rating: number;
  review_count: number;
  avg_response_hours: number | null;
  price_krw: number;
  specialties: string[];
};

export type CoachingRequestRow = {
  id: string;
  status: string;
  clip_url: string | null;
  clip_start_ms: number;
  clip_end_ms: number;
  issue_phase: string | null;
  diagnosis_pattern_id: string | null;
  diagnosis_summary: string | null;
  price_krw: number | null;
  coach_id: string | null;
  coach_reply_text: string | null;
  coach_replied_at: string | null;
  created_at: string;
  session_id: string | null;
  report_id: string | null;
};

type SessionForCoaching = {
  id: string;
  user_id: string;
  video_url: string | null;
  duration_ms: number;
  phases: { phase?: string; timestampMs?: number }[] | null;
  phases_verified: { phase?: string; timestampMs?: number }[] | null;
};

function coachingPatternFromDrill(drillId: string | null): string | null {
  if (!drillId) return null;
  if (drillId.includes('towel') || drillId.includes('hip')) return 'over_the_top';
  if (drillId.includes('step') || drillId.includes('weight')) {
    return 'impact_weight_shift';
  }
  if (drillId.includes('wall') || drillId.includes('posture')) {
    return 'early_extension';
  }
  if (drillId.includes('tempo') || drillId.includes('smooth')) return 'overall_good';
  return null;
}

function coachingSummary(text: string | null): string {
  if (!text) {
    return '스윙 컨디셔닝 인사이트를 함께 확인해 주세요.';
  }
  const factMark = text.indexOf('[근거]');
  return (factMark >= 0 ? text.slice(0, factMark) : text)
    .replace(/부상|위험|진단/g, '참고')
    .trim()
    .slice(0, 500);
}

/**
 * API가 배포되지 않은 환경에서도 원본 영상을 사용하는 draft를 만든다.
 * 코치는 전체 영상에서 필요한 구간을 직접 선택한다.
 */
async function createOriginalVideoCoachingRequestUnsafe(
  sessionId: string,
): Promise<{
  ok: boolean;
  requestId?: string;
  clipUrl?: string;
  message?: string;
}> {
  const userId = await ensureAnonymousUserId();
  const supabase = getSupabaseClient();
  if (!userId || !supabase) {
    return { ok: false, message: '로그인이 필요합니다' };
  }

  const [{ data: session, error: sessionError }, { data: report, error: reportError }] =
    await Promise.all([
      supabase
        .from('swing_sessions')
        .select('id, user_id, video_url, duration_ms, phases, phases_verified')
        .eq('id', sessionId)
        .maybeSingle(),
      supabase
        .from('swing_reports')
        .select('id, issue_phase, diagnosis_text, recommended_drill_id')
        .eq('session_id', sessionId)
        .maybeSingle(),
    ]);
  if (sessionError || !session) {
    console.warn('[createOriginalVideoCoachingRequest] session', sessionError?.message);
    return { ok: false, message: '스윙 세션을 찾을 수 없어요' };
  }
  if (reportError || !report) {
    console.warn('[createOriginalVideoCoachingRequest] report', reportError?.message);
    return { ok: false, message: '스윙 리포트가 아직 준비되지 않았어요' };
  }

  const source = session as SessionForCoaching;
  if (!source.video_url) {
    return { ok: false, message: '코칭용 스윙 영상이 필요해요' };
  }
  const phases =
    source.phases_verified && source.phases_verified.length > 0
      ? source.phases_verified
      : source.phases ?? [];
  const issuePhase = report.issue_phase as string | null;
  const marker = phases.find((item) => item.phase === issuePhase);
  const centerMs =
    typeof marker?.timestampMs === 'number' && Number.isFinite(marker.timestampMs)
      ? marker.timestampMs
      : Math.max(0, Number(source.duration_ms) / 2);
  const durationMs = Math.max(1000, Number(source.duration_ms) || 1000);
  const startMs = Math.max(0, Math.round(centerMs - 4000));
  const endMs = Math.max(
    startMs + 1,
    Math.min(durationMs, Math.round(centerMs + 4000)),
  );

  const { data: created, error } = await supabase
    .from('coaching_requests')
    .insert({
      user_id: userId,
      coach_id: null,
      session_id: sessionId,
      report_id: report.id,
      clip_url: source.video_url,
      clip_start_ms: startMs,
      clip_end_ms: endMs,
      issue_phase: issuePhase,
      diagnosis_pattern_id: coachingPatternFromDrill(
        report.recommended_drill_id as string | null,
      ),
      diagnosis_summary: coachingSummary(report.diagnosis_text as string | null),
      status: 'draft',
      price_krw: null,
    })
    .select('id')
    .single();
  if (error || !created) {
    console.warn('[createOriginalVideoCoachingRequest] insert', error?.message);
    return { ok: false, message: '코칭 요청을 만들지 못했어요. 다시 시도해 주세요' };
  }
  return {
    ok: true,
    requestId: created.id as string,
    clipUrl: source.video_url,
  };
}

async function createOriginalVideoCoachingRequest(
  sessionId: string,
): Promise<{
  ok: boolean;
  requestId?: string;
  clipUrl?: string;
  message?: string;
}> {
  try {
    return await createOriginalVideoCoachingRequestUnsafe(sessionId);
  } catch (error) {
    console.warn('[createOriginalVideoCoachingRequest] network', error);
    return { ok: false, message: '인터넷 연결을 확인한 뒤 다시 시도해 주세요' };
  }
}

async function assignCoachWithSupabase(
  requestId: string,
  coachId: string,
): Promise<{ ok: boolean; priceKrw?: number; message?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: '코칭 서비스 설정을 확인해 주세요' };
  }
  try {
    const { data: coach, error: coachError } = await supabase
      .from('coaches')
      .select('id, price_krw')
      .eq('id', coachId)
      .eq('is_active', true)
      .maybeSingle();
    if (coachError || !coach) {
      console.warn('[assignCoachWithSupabase] coach', coachError?.message);
      return { ok: false, message: '선택한 코치를 확인할 수 없어요' };
    }
    const { error } = await supabase
      .from('coaching_requests')
      .update({ coach_id: coach.id, price_krw: coach.price_krw })
      .eq('id', requestId)
      .eq('status', 'draft');
    if (error) {
      console.warn('[assignCoachWithSupabase] request', error.message);
      return { ok: false, message: '코치 지정에 실패했어요. 다시 시도해 주세요' };
    }
    return { ok: true, priceKrw: Number(coach.price_krw) };
  } catch (error) {
    console.warn('[assignCoachWithSupabase] network', error);
    return { ok: false, message: '인터넷 연결을 확인한 뒤 다시 시도해 주세요' };
  }
}

async function sendRequestWithSupabase(
  requestId: string,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, message: '코칭 서비스 설정을 확인해 주세요' };
  }
  try {
    const { data: request, error: requestError } = await supabase
      .from('coaching_requests')
      .select('coach_id, price_krw, clip_url')
      .eq('id', requestId)
      .eq('status', 'draft')
      .maybeSingle();
    if (requestError || !request) {
      console.warn('[sendRequestWithSupabase] request', requestError?.message);
      return { ok: false, message: '전송할 코칭 요청을 찾을 수 없어요' };
    }
    if (!request.coach_id || request.price_krw == null || !request.clip_url) {
      return { ok: false, message: '코치와 영상을 먼저 선택해 주세요' };
    }
    const { data: updated, error } = await supabase
      .from('coaching_requests')
      .update({ status: 'pending' })
      .eq('id', requestId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();
    if (error || !updated) {
      console.warn('[sendRequestWithSupabase] update', error?.message);
      return { ok: false, message: '코칭 요청 전송에 실패했어요. 다시 시도해 주세요' };
    }
    return { ok: true };
  } catch (error) {
    console.warn('[sendRequestWithSupabase] network', error);
    return { ok: false, message: '인터넷 연결을 확인한 뒤 다시 시도해 주세요' };
  }
}

export async function extractCoachingClip(sessionId: string): Promise<{
  ok: boolean;
  requestId?: string;
  clipUrl?: string;
  message?: string;
}> {
  const base = analyzeBaseUrl();
  if (!base) {
    return createOriginalVideoCoachingRequest(sessionId);
  }
  await ensureAnonymousUserId();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  try {
    const response = await fetch(`${base}/coaching/extract`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId }),
    });
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      requestId?: string;
      clipUrl?: string;
      error?: string;
      message?: string;
    } | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message: json?.message ?? json?.error ?? `HTTP ${response.status}`,
      };
    }
    return { ok: true, requestId: json.requestId, clipUrl: json.clipUrl };
  } catch (e) {
    console.warn('[extractCoachingClip] API unavailable; using original video', e);
    return createOriginalVideoCoachingRequest(sessionId);
  }
}

export async function assignCoachToRequest(
  requestId: string,
  coachId: string,
): Promise<{ ok: boolean; priceKrw?: number; message?: string }> {
  const base = analyzeBaseUrl();
  if (!base) {
    return assignCoachWithSupabase(requestId, coachId);
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  try {
    const response = await fetch(`${base}/coaching/requests/${requestId}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ coachId }),
    });
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      priceKrw?: number;
      error?: string;
      message?: string;
    } | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message: json?.message ?? json?.error ?? `HTTP ${response.status}`,
      };
    }
    return { ok: true, priceKrw: json.priceKrw };
  } catch (e) {
    console.warn('[assignCoachToRequest] API unavailable; using Supabase', e);
    return assignCoachWithSupabase(requestId, coachId);
  }
}

export async function sendCoachingRequest(
  requestId: string,
): Promise<{ ok: boolean; message?: string }> {
  const base = analyzeBaseUrl();
  if (!base) {
    return sendRequestWithSupabase(requestId);
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  try {
    const response = await fetch(`${base}/coaching/requests/${requestId}/send`, {
      method: 'POST',
      headers,
    });
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      message?: string;
    } | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message: json?.message ?? json?.error ?? `HTTP ${response.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[sendCoachingRequest] API unavailable; using Supabase', e);
    return sendRequestWithSupabase(requestId);
  }
}

export async function fetchActiveCoaches(
  preferredPattern?: string | null,
): Promise<CoachRow[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from('coaches')
    .select(
      'id, name, avatar_url, bio, rating, review_count, avg_response_hours, price_krw, specialties',
    )
    .eq('is_active', true)
    .order('rating', { ascending: false });
  if (error) {
    console.warn('[fetchActiveCoaches]', error.message);
    return [];
  }
  const rows = (data ?? []) as CoachRow[];
  if (!preferredPattern) {
    return rows;
  }
  return [...rows].sort((a, b) => {
    const aHit = (a.specialties ?? []).includes(preferredPattern) ? 1 : 0;
    const bHit = (b.specialties ?? []).includes(preferredPattern) ? 1 : 0;
    if (aHit !== bHit) {
      return bHit - aHit;
    }
    return Number(b.rating) - Number(a.rating);
  });
}

export async function fetchMyCoachingRequests(): Promise<CoachingRequestRow[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }
  await ensureAnonymousUserId();
  const { data, error } = await supabase
    .from('coaching_requests')
    .select(
      'id, status, clip_url, clip_start_ms, clip_end_ms, issue_phase, diagnosis_pattern_id, diagnosis_summary, price_krw, coach_id, coach_reply_text, coach_replied_at, created_at, session_id, report_id',
    )
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('[fetchMyCoachingRequests]', error.message);
    return [];
  }
  return (data ?? []) as CoachingRequestRow[];
}

export async function fetchCoachingRequest(
  requestId: string,
): Promise<CoachingRequestRow | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase
    .from('coaching_requests')
    .select(
      'id, status, clip_url, clip_start_ms, clip_end_ms, issue_phase, diagnosis_pattern_id, diagnosis_summary, price_krw, coach_id, coach_reply_text, coach_replied_at, created_at, session_id, report_id',
    )
    .eq('id', requestId)
    .maybeSingle();
  if (error) {
    console.warn('[fetchCoachingRequest]', error.message);
    return null;
  }
  return data as CoachingRequestRow | null;
}

export async function createCoachingClipSignedUrl(
  clipUrl: string,
): Promise<string | null> {
  if (!clipUrl || !isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const trimmed = clipUrl.replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  const bucket = trimmed.slice(0, slash);
  const path = trimmed.slice(slash + 1);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    console.warn('[createCoachingClipSignedUrl]', error?.message);
    return null;
  }
  return data.signedUrl;
}
