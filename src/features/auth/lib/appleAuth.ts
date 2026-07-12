/**
 * iOS/Android 공통 — Apple은 Supabase OAuth(웹)만 사용.
 * 네이티브 expo-apple-authentication / ExpoCrypto 불필요 (Dev Client 재빌드 없이 동작).
 */

import { signInWithOAuthProvider } from './oauth';

export async function signInWithApple(): Promise<void> {
  await signInWithOAuthProvider('apple');
}
