/**
 * pending/error 세션 재시도 — 포그라운드 복귀 + 네트워크 복구 시.
 * (네이티브 NetInfo 없이 reachability fetch로 복구 감지)
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { isSupabaseConfigured } from '../../../services/supabase/client';
import { syncPendingSwingSessions } from '../store/swingSessionStore';

/** 네트워크 복구 폴링 간격 */
const REACHABILITY_POLL_MS = 4000;
/** reachability 타임아웃 */
const REACHABILITY_TIMEOUT_MS = 3000;

async function probeInternetReachable(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  if (!base) {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    // auth health는 가벼움 — CORS/리다이렉트여도 네트워크 자체는 살아 있음
    await fetch(`${base}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useSessionSyncRetryQueue(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const syncingRef = useRef(false);
  const wasReachableRef = useRef<boolean | null>(null);

  useEffect(() => {
    const runSync = (reason: string) => {
      if (syncingRef.current) {
        return;
      }
      syncingRef.current = true;
      void syncPendingSwingSessions()
        .then((result) => {
          if (result.synced > 0 || result.failed > 0) {
            console.log('[sessionSyncRetry]', reason, result);
          }
        })
        .catch((error: unknown) => {
          console.warn(
            '[sessionSyncRetry] failed',
            reason,
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => {
          syncingRef.current = false;
        });
    };

    const checkReachability = async () => {
      if (AppState.currentState !== 'active') {
        return;
      }
      const reachable = await probeInternetReachable();
      const prev = wasReachableRef.current;
      wasReachableRef.current = reachable;
      // 오프라인→온라인 전이만 재시도 (최초 null은 스킵 — 포그라운드 훅이 담당)
      if (prev === false && reachable) {
        runSync('network_recovered');
      }
    };

    const appSub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (
        next === 'active' &&
        (prev === 'background' || prev === 'inactive')
      ) {
        runSync('foreground');
        void checkReachability();
      }
    });

    const pollId = setInterval(() => {
      void checkReachability();
    }, REACHABILITY_POLL_MS);

    // 첫 샘플 (전이 감지용 기준선)
    void checkReachability();

    return () => {
      appSub.remove();
      clearInterval(pollId);
    };
  }, []);
}

/** @deprecated useSessionSyncRetryQueue 사용 */
export const useSyncOnForeground = useSessionSyncRetryQueue;
