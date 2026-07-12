/**
 * 개발 및 내부 배포 전용 — OAuth 미연동 시 온보딩 게이트 우회.
 * 익명 세션 + 로컬 플래그로 프로필 화면까지 진행.
 */

import { fileKvStore } from '../../../services/storage/fileKvStore';

const KEY = 'auth.devBypassSocial';

export function isDevAuthBypassEnabled(): boolean {
  return (
    __DEV__ || process.env.EXPO_PUBLIC_ENABLE_DEV_TEMP_LOGIN === 'true'
  );
}

export async function getDevAuthBypass(): Promise<boolean> {
  if (!isDevAuthBypassEnabled()) {
    return false;
  }
  return (await fileKvStore.getItem(KEY)) === '1';
}

export async function setDevAuthBypass(enabled: boolean): Promise<void> {
  if (!isDevAuthBypassEnabled()) {
    return;
  }
  if (enabled) {
    await fileKvStore.setItem(KEY, '1');
    return;
  }
  await fileKvStore.removeItem(KEY);
}
