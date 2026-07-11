/**
 * 앱이 포그라운드로 돌아올 때 pending/error 세션 동기화 재시도.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { syncPendingSwingSessions } from '../store/swingSessionStore';

export function useSyncOnForeground(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const syncingRef = useRef(false);

  useEffect(() => {
    const runSync = () => {
      if (syncingRef.current) {
        return;
      }
      syncingRef.current = true;
      void syncPendingSwingSessions()
        .catch((error: unknown) => {
          console.warn(
            '[useSyncOnForeground] sync failed',
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => {
          syncingRef.current = false;
        });
    };

    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (
        next === 'active' &&
        (prev === 'background' || prev === 'inactive')
      ) {
        runSync();
      }
    });

    return () => sub.remove();
  }, []);
}
