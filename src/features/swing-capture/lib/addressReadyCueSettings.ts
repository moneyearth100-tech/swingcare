/**
 * 게이트 2 — 「스윙하세요」 음성 큐 ON/OFF 설정.
 * 기본값 ON. fileKvStore로 persist (네이티브 재빌드 불필요).
 */

import { fileKvStore } from '../../../services/storage/fileKvStore';

const KEY = 'swing_address_ready_voice_enabled';

export const ADDRESS_READY_VOICE_DEFAULT = true;

export async function getAddressReadyVoiceEnabled(): Promise<boolean> {
  const raw = await fileKvStore.getItem(KEY);
  if (raw == null) {
    return ADDRESS_READY_VOICE_DEFAULT;
  }
  return raw === '1' || raw === 'true';
}

export async function setAddressReadyVoiceEnabled(
  enabled: boolean,
): Promise<void> {
  await fileKvStore.setItem(KEY, enabled ? '1' : '0');
}
