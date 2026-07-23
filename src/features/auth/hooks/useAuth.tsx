/**
 * Auth 세션 + 신체·이력 프로필.
 * 소셜/임시 로그인 없이 부팅 시 익명 세션을 자동 확보하고 앱을 바로 연다.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import {
  ensureAnonymousUser,
  getSupabaseClient,
  isSupabaseConfigured,
} from '../../../services/supabase/client';

import {
  isDevAuthBypassEnabled,
  setDevAuthBypass,
} from '../lib/devAuthBypass';
import {
  isProfileComplete,
  type UserProfile,
} from '../lib/profileTypes';
import {
  ensureUserProfileRow,
  fetchUserProfile,
} from '../lib/userProfile';

/** 실제 소셜(카카오/애플 등) 계정인지 — 익명 제외 */
export function isSocialUser(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }
  if (user.is_anonymous === true) {
    return false;
  }
  const provider = user.app_metadata?.provider;
  if (provider === 'anonymous') {
    return false;
  }
  return true;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isConfigured: boolean;
  /**
   * 앱 진입 가능 여부.
   * 익명 자동 로그인 성공 시 true. (하위 호환 이름 유지)
   */
  isSocialUser: boolean;
  profile: UserProfile | null;
  isProfileComplete: boolean;
  refresh: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** @deprecated 부팅 시 자동 익명 — 수동 호출은 동일하게 익명 확보 */
  skipSocialLoginForDev: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const configured = isSupabaseConfigured();

  const loadProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setProfile(null);
      return;
    }
    const row =
      (await ensureUserProfileRow(user.id)) ??
      (await fetchUserProfile(user.id));
    setProfile(row);
  }, []);

  const refresh = useCallback(async () => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setSession(null);
      setProfile(null);
      setIsLoading(false);
      return;
    }

    // 소셜/임시 로그인 없이 바로 사용 — 익명 세션 자동 확보
    const anon = await ensureAnonymousUser();
    if (!anon.userId && anon.errorMessage) {
      console.warn('[auth] auto anonymous failed', anon.errorMessage);
    }

    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadProfile(data.session?.user ?? null);
    setIsLoading(false);
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user ?? null);
  }, [loadProfile, session?.user]);

  useEffect(() => {
    void refresh();
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setIsLoading(true);
      void (async () => {
        await loadProfile(next?.user ?? null);
        setIsLoading(false);
      })();
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadProfile, refresh]);

  const skipSocialLoginForDev = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase 미설정');
    }
    const { userId, errorMessage } = await ensureAnonymousUser();
    if (!userId) {
      const detail = errorMessage?.trim() || '알 수 없는 오류';
      throw new Error(`익명 로그인 실패: ${detail}`);
    }
    if (isDevAuthBypassEnabled()) {
      await setDevAuthBypass(true);
    }
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await setDevAuthBypass(false);
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSession(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
    // 로그아웃 후 바로 다시 익명으로 재진입
    const anon = await ensureAnonymousUser();
    if (!anon.userId) {
      setSession(null);
      setProfile(null);
      return;
    }
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadProfile(data.session?.user ?? null);
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const canEnterApp = user != null;
    return {
      session,
      user,
      isLoading,
      isConfigured: configured,
      isSocialUser: canEnterApp,
      profile,
      isProfileComplete: isProfileComplete(profile),
      refresh,
      refreshProfile,
      skipSocialLoginForDev,
      signOut,
    };
  }, [
    configured,
    isLoading,
    profile,
    refresh,
    refreshProfile,
    session,
    signOut,
    skipSocialLoginForDev,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
