import type { SupabaseClient } from '@supabase/supabase-js';

export type CoachSession = {
  userId: string;
  email: string | null;
  coachId: string;
  coachName: string;
};

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

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'coach') {
    return null;
  }

  const { data: coach } = await supabase
    .from('coaches')
    .select('id, name')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!coach) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    coachId: coach.id,
    coachName: coach.name,
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
