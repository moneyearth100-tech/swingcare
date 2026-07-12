/**
 * 코칭 마켓 클라이언트 — extract / assign / send + 목록 조회.
 */

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';

function analyzeBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_ANALYZE_API_URL ?? '').replace(/\/$/, '');
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

export async function extractCoachingClip(sessionId: string): Promise<{
  ok: boolean;
  requestId?: string;
  clipUrl?: string;
  message?: string;
}> {
  const base = analyzeBaseUrl();
  if (!base) {
    return { ok: false, message: '분석 API URL이 설정되지 않았어요' };
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
    return {
      ok: false,
      message: e instanceof Error ? e.message : '네트워크 오류',
    };
  }
}

export async function assignCoachToRequest(
  requestId: string,
  coachId: string,
): Promise<{ ok: boolean; priceKrw?: number; message?: string }> {
  const base = analyzeBaseUrl();
  if (!base) {
    return { ok: false, message: '분석 API URL이 설정되지 않았어요' };
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
    return {
      ok: false,
      message: e instanceof Error ? e.message : '네트워크 오류',
    };
  }
}

export async function sendCoachingRequest(
  requestId: string,
): Promise<{ ok: boolean; message?: string }> {
  const base = analyzeBaseUrl();
  if (!base) {
    return { ok: false, message: '분석 API URL이 설정되지 않았어요' };
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
    return {
      ok: false,
      message: e instanceof Error ? e.message : '네트워크 오류',
    };
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
