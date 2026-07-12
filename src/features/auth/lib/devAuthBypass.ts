/**
 * __DEV__ 전용 — OAuth 미연동 시 온보딩 게이트 우회.
 * 익명 세션 + 로컬 플래그로 프로필 화면까지 진행.
 */

import { fileKvStore } from '../../../services/storage/fileKvStore';

const KEY = 'auth.devBypassSocial';

export async function getDevAuthBypass(): Promise<boolean> {
  if (!__DEV__) {
    return false;
  }
  return (await fileKvStore.getItem(KEY)) === '1';
}

export async function setDevAuthBypass(enabled: boolean): Promise<void> {
  if (!__DEV__) {
    return;
  }
  if (enabled) {
    await fileKvStore.setItem(KEY, '1');
    return;
  }
  await fileKvStore.removeItem(KEY);
}
