/**
 * 스윙 세션 로컬 저장(오프라인 우선) + Supabase 동기화 큐.
 * 로컬에는 LandmarkFrame[] / PhaseMarker[] + localVideoUri(원본 영상)를 둔다.
 * Storage 업로드(video_url)는 코칭 요청 시에만 수행한다.
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
  /** Documents 등에 보관한 원본 영상 URI. Storage 업로드 전 리뷰용. */
  localVideoUri?: string | null;
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

/** 영상 파일명과 세션 id를 맞출 때 사용 */
export function createSwingSessionId(): string {
  return createId();
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
  /** 미리 확보한 id (영상 Documents 파일명과 맞출 때) */
  id?: string;
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
    id: input.id ?? createId(),
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

export async function getStoredSwingSessionById(
  sessionId: string,
): Promise<StoredSwingSession | null> {
  const sessions = await readAll();
  return sessions.find((s) => s.id === sessionId) ?? null;
}

/** 로컬 원본 영상 URI를 세션에 연결 (Storage 업로드와 무관) */
export async function setStoredSwingSessionLocalVideo(
  sessionId: string,
  localVideoUri: string,
): Promise<StoredSwingSession | null> {
  const sessions = await readAll();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) {
    return null;
  }
  const next = [...sessions];
  next[index] = { ...next[index], localVideoUri };
  await writeAll(next);
  return next[index];
}

/** 로컬 영상 삭제 후 세션의 localVideoUri 만 비움 (리포트·스켈레톤은 유지) */
export async function clearStoredSwingSessionLocalVideo(
  sessionId: string,
): Promise<StoredSwingSession | null> {
  const sessions = await readAll();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) {
    return null;
  }
  const next = [...sessions];
  next[index] = { ...next[index], localVideoUri: null };
  await writeAll(next);
  return next[index];
}

/** 모든 세션의 localVideoUri 비움 */
export async function clearAllStoredSwingSessionLocalVideos(): Promise<number> {
  const sessions = await readAll();
  let cleared = 0;
  const next = sessions.map((session) => {
    if (session.localVideoUri) {
      cleared += 1;
      return { ...session, localVideoUri: null };
    }
    return session;
  });
  if (cleared > 0) {
    await writeAll(next);
  }
  return cleared;
}

/** 로컬 세션 JSON 제거 (영상·원격은 호출측에서 처리) */
export async function removeStoredSwingSession(
  sessionId: string,
): Promise<boolean> {
  const sessions = await readAll();
  const next = sessions.filter((s) => s.id !== sessionId);
  if (next.length === sessions.length) {
    return false;
  }
  await writeAll(next);
  return true;
}

export async function removeStoredSwingSessions(
  sessionIds: readonly string[],
): Promise<number> {
  if (sessionIds.length === 0) {
    return 0;
  }
  const idSet = new Set(sessionIds);
  const sessions = await readAll();
  const next = sessions.filter((s) => !idSet.has(s.id));
  const removed = sessions.length - next.length;
  if (removed > 0) {
    await writeAll(next);
  }
  return removed;
}

/**
 * 갤러리 분석 등 — 이미 원격 동기화된 세션을 로컬 목록에도 남겨
 * localVideoUri로 리뷰할 수 있게 한다.
 */
export async function rememberSyncedSwingSession(input: {
  session: SwingSession;
  localVideoUri: string | null;
}): Promise<StoredSwingSession> {
  const sessions = await readAll();
  const stored: StoredSwingSession = {
    ...input.session,
    syncStatus: 'synced',
    lastSyncError: null,
    localVideoUri: input.localVideoUri,
  };
  await writeAll([stored, ...sessions.filter((s) => s.id !== stored.id)]);
  return stored;
}
