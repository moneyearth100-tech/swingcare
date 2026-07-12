/**
 * 챌린지 탭 조회 훅 (서비스 레이어는 services/supabase/challenges.ts).
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  fetchGlobalLeaderboard,
  fetchLeagueMe,
  fetchMissions,
  type LeaderboardEntry,
  type LeagueMeState,
  type MissionCard,
} from '@/services/supabase/challenges';

export function useChallengeMissions() {
  const [missions, setMissions] = useState<MissionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMissions(await fetchMissions());
    } catch (e) {
      setError(e instanceof Error ? e.message : '챌린지 목록 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { missions, loading, error, reload };
}

export function useLeagueMe() {
  const [league, setLeague] = useState<LeagueMeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeague(await fetchLeagueMe());
    } catch (e) {
      setError(e instanceof Error ? e.message : '리그 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { league, loading, error, reload };
}

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

/** 챌린지 탭 3패널 일괄 로드 */
export function useChallengeTabData() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [league, setLeague] = useState<LeagueMeState | null>(null);
  const [missions, setMissions] = useState<MissionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [board, leagueMe, missionList] = await Promise.all([
        fetchGlobalLeaderboard(20),
        fetchLeagueMe(),
        fetchMissions(),
      ]);
      setLeaderboard(board);
      setLeague(leagueMe);
      setMissions(missionList);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { leaderboard, league, missions, loading, error, reload };
}
