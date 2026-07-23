/** Supabase 클라이언트 — 익명 세션 persist (expo-file-system KV) */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { fileKvStore } from '../storage/fileKvStore';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

export function isSupabaseConfigured(): boolean {
  return supabaseUrl.length > 0 && supabaseAnonKey.length > 0;
}

/** 진단용 — 키 값은 노출하지 않음 */
export function getSupabaseConfigStatus(): {
  configured: boolean;
  hasUrl: boolean;
  hasAnonKey: boolean;
} {
  return {
    configured: isSupabaseConfigured(),
    hasUrl: supabaseUrl.length > 0,
    hasAnonKey: supabaseAnonKey.length > 0,
  };
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    if (__DEV__) {
      console.warn('[supabase] not configured', getSupabaseConfigStatus());
    }
    return null;
  }
  if (!client) {
    if (__DEV__) {
      console.log('[supabase] config', {
        hasUrl: supabaseUrl.length > 0,
        hasAnonKey: supabaseAnonKey.length > 0,
      });
    }
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: fileKvStore,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** 익명 로그인 보장 후 user id 반환 (미설정/실패 시 null + 원인) */
export async function ensureAnonymousUserId(): Promise<string | null> {
  const result = await ensureAnonymousUser();
  return result.userId;
}

export type EnsureAnonymousResult = {
  userId: string | null;
  errorMessage: string | null;
};

/**
 * 익명 로그인. 실패 시 Dashboard 문구만 보여주지 않고 서버 에러를 그대로 남긴다.
 */
export async function ensureAnonymousUser(): Promise<EnsureAnonymousResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      userId: null,
      errorMessage: 'Supabase 미설정 (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY)',
    };
  }

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('[supabase] getSession', sessionError.message);
    }
    if (session?.user?.id) {
      return { userId: session.user.id, errorMessage: null };
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn('[supabase] anonymous sign-in failed', error.message, error);
      return { userId: null, errorMessage: error.message };
    }
    if (!data.user?.id) {
      return {
        userId: null,
        errorMessage: '익명 로그인 응답에 user가 없습니다.',
      };
    }
    return { userId: data.user.id, errorMessage: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '익명 로그인 중 예외가 발생했습니다.';
    console.warn('[supabase] anonymous sign-in exception', message);
    return { userId: null, errorMessage: message };
  }
}
