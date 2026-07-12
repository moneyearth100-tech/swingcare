/**
 * 챌린지 탭 조회 훅 — 친구 랭킹만 로드.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  fetchGlobalLeaderboard,
  type LeaderboardEntry,
} from '@/services/supabase/challenges';

export function useGlobalLeaderboard(limit = 20) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeaderboard(await fetchGlobalLeaderboard(limit));
    } catch (e) {
      setError(e instanceof Error ? e.message : '랭킹 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { leaderboard, loading, error, reload };
}

/** 챌린지 탭 랭킹 로드 */
export function useChallengeTabData() {
  return useGlobalLeaderboard(20);
}
