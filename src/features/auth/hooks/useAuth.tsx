/**
 * Auth 세션 + 신체·이력 프로필 완료 여부.
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
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from '../../../services/supabase/client';

import { getDevAuthBypass, setDevAuthBypass } from '../lib/devAuthBypass';
import {
  isProfileComplete,
  type UserProfile,
} from '../lib/profileTypes';
import {
  ensureUserProfileRow,
  fetchUserProfile,
} from '../lib/userProfile';

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
  /** 소셜 로그인 또는 __DEV__ 스킵 */
  isSocialUser: boolean;
  profile: UserProfile | null;
  isProfileComplete: boolean;
  refresh: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** __DEV__: 익명 세션 + 게이트 우회 → 프로필 화면 */
  skipSocialLoginForDev: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [devBypass, setDevBypass] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const configured = isSupabaseConfigured();

  const loadProfile = useCallback(
    async (user: User | null, bypass: boolean) => {
      if (!user) {
        setProfile(null);
        return;
      }
      if (!isSocialUser(user) && !bypass) {
        setProfile(null);
        return;
      }
      const row =
        (await ensureUserProfileRow(user.id)) ??
        (await fetchUserProfile(user.id));
      setProfile(row);
    },
    [],
  );

  const refresh = useCallback(async () => {
    const supabase = getSupabaseClient();
    const bypass = await getDevAuthBypass();
    setDevBypass(bypass);

    if (!supabase) {
      setSession(null);
      setProfile(null);
      setIsLoading(false);
      return;
    }
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadProfile(data.session?.user ?? null, bypass);
    setIsLoading(false);
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    const user = session?.user ?? null;
    await loadProfile(user, devBypass);
  }, [devBypass, loadProfile, session?.user]);

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
        const bypass = await getDevAuthBypass();
        setDevBypass(bypass);
        await loadProfile(next?.user ?? null, bypass);
        setIsLoading(false);
      })();
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadProfile, refresh]);

  const skipSocialLoginForDev = useCallback(async () => {
    if (!__DEV__) {
      return;
    }
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase 미설정');
    }
    const userId = await ensureAnonymousUserId();
    if (!userId) {
      throw new Error(
        '익명 로그인 실패. Dashboard → Authentication → Anonymous를 켜 주세요.',
      );
    }
    await setDevAuthBypass(true);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await setDevAuthBypass(false);
    setDevBypass(false);
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSession(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const social =
      user != null && (isSocialUser(user) || (__DEV__ && devBypass));
    return {
      session,
      user,
      isLoading,
      isConfigured: configured,
      isSocialUser: social,
      profile,
      isProfileComplete: social && isProfileComplete(profile),
      refresh,
      refreshProfile,
      skipSocialLoginForDev,
      signOut,
    };
  }, [
    configured,
    devBypass,
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
