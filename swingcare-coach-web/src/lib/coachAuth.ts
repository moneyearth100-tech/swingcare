import { cache } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

export type CoachSession = {
  userId: string;
  email: string | null;
  coachId: string;
  coachName: string;
};

/**
 * 요청당 1회만 실행 (page + CoachShell 중복 제거).
 */
export const getServerSupabase = cache(async () => createClient());

export const getCoachSession = cache(async (): Promise<CoachSession | null> => {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return null;
  }
  return requireCoachSession(supabase);
});

/**
 * 로그인 유저가 coach role + coaches.auth_user_id 매핑을 갖는지 확인.
 */
export async function requireCoachSession(
  supabase: SupabaseClient,
): Promise<CoachSession | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const [profileRes, coachRes] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).maybeSingle(),
    supabase
      .from('coaches')
      .select('id, name')
      .eq('auth_user_id', user.id)
      .maybeSingle(),
  ]);

  if (!profileRes.data || profileRes.data.role !== 'coach') {
    return null;
  }
  if (!coachRes.data) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    coachId: coachRes.data.id,
    coachName: coachRes.data.name,
  };
}

export async function createClipSignedUrl(
  supabase: SupabaseClient,
  clipUrl: string | null,
): Promise<string | null> {
  if (!clipUrl) {
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
    console.warn('[createClipSignedUrl]', error?.message);
    return null;
  }
  return data.signedUrl;
}
