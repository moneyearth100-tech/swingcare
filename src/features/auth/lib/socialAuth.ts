/**
 * 소셜 로그인 엔트리 — Apple / Google / Kakao / Naver.
 * Apple은 동적 import로 ExpoCrypto/AppleAuthentication 정적 로드 크래시 방지.
 * Naver는 Supabase 네이티브 미지원 → UI만 두고 안내 (커스텀 OAuth는 후속).
 */

import { signInWithOAuthProvider } from './oauth';

export type SocialProviderId = 'apple' | 'google' | 'kakao' | 'naver';

export async function signInWithSocialProvider(
  provider: SocialProviderId,
): Promise<void> {
  switch (provider) {
    case 'apple': {
      const { signInWithApple } = await import('./appleAuth');
      await signInWithApple();
      return;
    }
    case 'google':
      await signInWithOAuthProvider('google');
      return;
    case 'kakao':
      await signInWithOAuthProvider('kakao');
      return;
    case 'naver':
      throw new Error(
        '네이버 로그인은 곧 연결됩니다. 지금은 Apple·Google·카카오로 시작해 주세요.',
      );
    default: {
      const _exhaustive: never = provider;
      throw new Error(`지원하지 않는 제공자: ${_exhaustive}`);
    }
  }
}
