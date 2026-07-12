/**
 * Supabase OAuth / deep-link 세션 생성 (Expo WebBrowser).
 * 익명 세션이 있으면 linkIdentity로 UID 유지(스윙 세션·users 행 연결).
 */

import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { getSupabaseClient } from '../../../services/supabase/client';

WebBrowser.maybeCompleteAuthSession();

export type SocialOAuthProvider = 'google' | 'apple' | 'kakao';

export function getAuthRedirectUri(): string {
  return Linking.createURL('auth/callback');
}

export async function createSessionFromUrl(url: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase 미설정');
  }

  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) {
    throw new Error(String(errorCode));
  }

  const access_token = params.access_token;
  const refresh_token = params.refresh_token;
  if (!access_token || !refresh_token) {
    throw new Error('인증 토큰이 없습니다. Redirect URL 설정을 확인해주세요.');
  }

  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) {
    throw error;
  }
}

async function openOAuthUrl(url: string, redirectTo: string): Promise<void> {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    throw new Error('로그인이 취소되었거나 완료되지 않았습니다.');
  }
  await createSessionFromUrl(result.url);
}

export async function signInWithOAuthProvider(
  provider: SocialOAuthProvider,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      'Supabase가 설정되지 않았습니다. EXPO_PUBLIC_SUPABASE_URL / ANON_KEY를 확인해주세요.',
    );
  }

  const redirectTo = getAuthRedirectUri();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const isAnonymous = session?.user?.is_anonymous === true;

  if (isAnonymous) {
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error) {
      throw error;
    }
    if (!data.url) {
      throw new Error(
        '계정 연결 URL을 받지 못했습니다. Dashboard에서 제공자를 활성화해주세요.',
      );
    }
    await openOAuthUrl(data.url, redirectTo);
    return;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }
  if (!data.url) {
    throw new Error(
      'OAuth URL을 받지 못했습니다. Dashboard에서 제공자를 활성화해주세요.',
    );
  }

  await openOAuthUrl(data.url, redirectTo);
}
