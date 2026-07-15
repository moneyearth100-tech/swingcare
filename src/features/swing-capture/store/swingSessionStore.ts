/**
 * 스윙 세션 로컬 저장(오프라인 우선) + Supabase 동기화 큐.
 * 로컬에는 LandmarkFrame[] / PhaseMarker[]만 저장한다.
 * 영상은 네이티브 임시 파일에서 Storage로 직접 업로드한다.
 */

import { Platform } from 'react-native';

import type {
  LandmarkFrame,
  PhaseMarker,
  SwingSession,
} from '../lib/landmarkTypes';
import { fileKvStore } from '../../../services/storage/fileKvStore';
import { upsertSwingSession } from '../../../services/supabase/swingSessions';

const STORAGE_KEY = '@swingcare/swing_sessions_v1';

export type SessionSyncStatus = 'pending' | 'synced' | 'error';

export interface StoredSwingSession extends SwingSession {
  syncStatus: SessionSyncStatus;
  lastSyncError: string | null;
}

type Listener = () => void;

let cache: StoredSwingSession[] | null = null;
let hydrated = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // uuid 컬럼용 — 비표준 id면 PostgREST upsert가 실패함
  const hex = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function readAll(): Promise<StoredSwingSession[]> {
  if (cache) {
    return cache;
  }
  try {
    const raw = await fileKvStore.getItem(STORAGE_KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed: unknown = JSON.parse(raw);
    cache = Array.isArray(parsed) ? (parsed as StoredSwingSession[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function writeAll(sessions: StoredSwingSession[]): Promise<void> {
  cache = sessions;
  await fileKvStore.setItem(STORAGE_KEY, JSON.stringify(sessions));
  emit();
}

export async function hydrateSwingSessionStore(): Promise<void> {
  if (hydrated) {
    return;
  }
  await readAll();
  hydrated = true;
  emit();
}

export function subscribeSwingSessionStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStoredSwingSessionsSnapshot(): StoredSwingSession[] {
  return cache ?? [];
}

export function buildSwingSession(input: {
  frames: LandmarkFrame[];
  phases: PhaseMarker[];
  durationMs: number;
  fps?: number;
  /** 1폰 정면/측면 가이드 준수 시 front | side */
  cameraAngle?: SwingSession['cameraAngle'];
}): SwingSession {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const durationMs = Math.max(0, input.durationMs);
  const fps =
    input.fps ??
    (durationMs > 0 && input.frames.length > 1
      ? Number(
          ((input.frames.length - 1) / (durationMs / 1000)).toFixed(1),
        )
      : 0);

  return {
    id: createId(),
    userId: null,
    createdAt: new Date().toISOString(),
    frames: input.frames,
    phases: input.phases,
    durationMs,
    deviceInfo: { platform, fps },
    cameraAngle: input.cameraAngle ?? 'unknown',
  };
}

/** 로컬 즉시 저장 후 동기화까지 기다린 최신 상태 반환 */
export async function saveSwingSessionLocalFirst(
  session: SwingSession,
): Promise<StoredSwingSession> {
  const sessions = await readAll();
  const stored: StoredSwingSession = {
    ...session,
    syncStatus: 'pending',
    lastSyncError: null,
  };
  await writeAll([stored, ...sessions.filter((s) => s.id !== session.id)]);
  await syncPendingSwingSessions();
  const latest = (await readAll()).find((s) => s.id === session.id);
  return latest ?? stored;
}

export async function syncPendingSwingSessions(): Promise<{
  synced: number;
  failed: number;
  skipped: number;
}> {
  const sessions = await readAll();
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const next = [...sessions];

  for (let i = 0; i < next.length; i += 1) {
    const item = next[i];
    if (item.syncStatus === 'synced') {
      skipped += 1;
      continue;
    }

    const result = await upsertSwingSession(item);
    if (result.ok) {
      next[i] = {
        ...item,
        userId: result.userId,
        syncStatus: 'synced',
        lastSyncError: null,
      };
      synced += 1;
      console.log('[swingSessionStore] synced', item.id);
    } else if (result.reason === 'not_configured') {
      next[i] = {
        ...item,
        syncStatus: 'pending',
        lastSyncError: result.message,
      };
      skipped += 1;
      console.warn('[swingSessionStore] sync skipped (not configured)', result.message);
    } else {
      next[i] = {
        ...item,
        syncStatus: 'error',
        lastSyncError: result.message,
      };
      failed += 1;
      console.warn('[swingSessionStore] sync failed', result.reason, result.message);
    }
  }

  await writeAll(next);
  return { synced, failed, skipped };
}

export async function getLatestStoredSwingSession(): Promise<StoredSwingSession | null> {
  const sessions = await readAll();
  return sessions[0] ?? null;
}
