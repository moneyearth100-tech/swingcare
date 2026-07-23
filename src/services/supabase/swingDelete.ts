/**
 * 스윙 세션·리포트·로컬/원격 영상 일괄 삭제.
 * swing_reports 는 swing_sessions ON DELETE CASCADE.
 */

import { deleteLocalSwingVideo } from '../../features/swing-capture/lib/localSwingVideo';
import { removeStoredSwingSession } from '../../features/swing-capture/store/swingSessionStore';

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';
import { storagePathFromVideoUrl } from './swingPlayback';

export type DeleteSwingSessionResult = {
  ok: boolean;
  localVideoDeleted: boolean;
  localSessionRemoved: boolean;
  remoteDeleted: boolean;
  message?: string;
};

async function removeRemoteStorageObjects(
  urls: readonly (string | null | undefined)[],
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }
  const byBucket = new Map<string, string[]>();
  for (const url of urls) {
    if (!url || typeof url !== 'string') {
      continue;
    }
    try {
      const { bucket, path } = storagePathFromVideoUrl(url);
      const list = byBucket.get(bucket) ?? [];
      list.push(path);
      byBucket.set(bucket, list);
    } catch {
      // ignore invalid paths
    }
  }
  for (const [bucket, paths] of byBucket) {
    const unique = [...new Set(paths)];
    if (unique.length === 0) {
      continue;
    }
    const { error } = await supabase.storage.from(bucket).remove(unique);
    if (error) {
      console.warn('[deleteSwingSessionCompletely] storage', bucket, error.message);
    }
  }
}

/**
 * 로컬 영상 + 로컬 세션 + 원격 세션/리포트(+ Storage 파일) 삭제.
 */
export async function deleteSwingSessionCompletely(
  sessionId: string,
): Promise<DeleteSwingSessionResult> {
  const localVideoDeleted = deleteLocalSwingVideo(sessionId);
  const localSessionRemoved = await removeStoredSwingSession(sessionId);

  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      localVideoDeleted,
      localSessionRemoved,
      remoteDeleted: false,
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      ok: true,
      localVideoDeleted,
      localSessionRemoved,
      remoteDeleted: false,
      message: 'Supabase client unavailable',
    };
  }

  await ensureAnonymousUserId();

  const { data: remote, error: fetchError } = await supabase
    .from('swing_sessions')
    .select('id, video_url, thumbnail_url')
    .eq('id', sessionId)
    .maybeSingle();

  if (fetchError) {
    console.warn('[deleteSwingSessionCompletely] fetch', fetchError.message);
  }

  if (remote) {
    await removeRemoteStorageObjects([
      (remote as { video_url?: string | null }).video_url,
      (remote as { thumbnail_url?: string | null }).thumbnail_url,
    ]);
  }

  const { error: deleteError } = await supabase
    .from('swing_sessions')
    .delete()
    .eq('id', sessionId);

  if (deleteError) {
    console.warn('[deleteSwingSessionCompletely]', deleteError.message);
    return {
      ok: false,
      localVideoDeleted,
      localSessionRemoved,
      remoteDeleted: false,
      message: deleteError.message,
    };
  }

  return {
    ok: true,
    localVideoDeleted,
    localSessionRemoved,
    remoteDeleted: Boolean(remote) || !fetchError,
  };
}

export async function deleteSwingSessionsCompletely(
  sessionIds: readonly string[],
): Promise<{ okCount: number; failCount: number }> {
  let okCount = 0;
  let failCount = 0;
  for (const sessionId of sessionIds) {
    const result = await deleteSwingSessionCompletely(sessionId);
    if (result.ok) {
      okCount += 1;
    } else {
      failCount += 1;
    }
  }
  return { okCount, failCount };
}
