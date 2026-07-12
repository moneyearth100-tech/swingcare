/**
 * 챌린지 / 시즌 리그 / 글로벌 랭킹 (Supabase).
 * target_issue ≡ DiagnosisPatternId (issue_phase와 다름).
 */

import type { DiagnosisPatternId } from '../../features/swing-capture/lib/scoring/diagnosisTemplates';

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';

export type ChallengeType = 'mission' | 'league';

export interface ChallengeRow {
  id: string;
  title: string;
  type: ChallengeType;
  duration_days: number;
  badge_id: string | null;
  goal_count: number;
  target_issue: string | null;
  description: string | null;
  is_active: boolean;
}

export interface UserChallengeRow {
  id: string;
  user_id: string;
  challenge_id: string;
  progress: number;
  joined_at: string;
  completed_at: string | null;
}

export interface MissionCard {
  id: string;
  title: string;
  meta: string;
  progress: number;
  goalCount: number;
  progressLabel: string;
  participantCount: number;
  joined: boolean;
  completed: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  rankDelta: number | null;
  isMe: boolean;
}

export interface LeagueSeasonRow {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  tier_thresholds: Record<string, number>;
  is_active: boolean;
}

export interface LeagueMeState {
  season: LeagueSeasonRow;
  tier: string;
  points: number;
  nextTier: string | null;
  pointsToNext: number | null;
  progressInTier: number;
  daysLeft: number;
  tiers: string[];
}

const TIER_ORDER = ['bogey', 'birdie', 'eagle', 'albatross'] as const;

const TIER_LABEL_KO: Record<string, string> = {
  bogey: '보기',
  birdie: '버디',
  eagle: '이글',
  albatross: '알바트로스',
};

export function tierLabelKo(tier: string): string {
  return TIER_LABEL_KO[tier] ?? tier;
}

function resolveTier(
  points: number,
  thresholds: Record<string, number>,
): string {
  let current: string = 'bogey';
  for (const tier of TIER_ORDER) {
    const min = thresholds[tier];
    if (typeof min === 'number' && points >= min) {
      current = tier;
    }
  }
  return current;
}

export async function fetchMissions(): Promise<MissionCard[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) {
    return [];
  }

  await ensureAnonymousUserId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const { data: challenges, error } = await supabase
    .from('challenges')
    .select(
      'id, title, type, duration_days, badge_id, goal_count, target_issue, description, is_active',
    )
    .eq('type', 'mission')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error || !challenges) {
    console.warn('[fetchMissions]', error?.message);
    return [];
  }

  let mine: UserChallengeRow[] = [];
  if (userId) {
    const { data } = await supabase
      .from('user_challenges')
      .select('id, user_id, challenge_id, progress, joined_at, completed_at')
      .eq('user_id', userId);
    mine = (data ?? []) as UserChallengeRow[];
  }

  const { data: counts } = await supabase.rpc(
    'get_challenge_participant_counts',
  );
  const countMap = new Map<string, number>();
  for (const row of (counts ?? []) as {
    challenge_id: string;
    participant_count: number;
  }[]) {
    countMap.set(row.challenge_id, Number(row.participant_count));
  }

  return (challenges as ChallengeRow[]).map((c) => {
    const uc = mine.find((m) => m.challenge_id === c.id);
    const progress = uc?.progress ?? 0;
    const joined = uc != null;
    const completed = uc?.completed_at != null;
    const participantCount = countMap.get(c.id) ?? (joined ? 1 : 0);
    const meta =
      c.description ??
      (joined
        ? completed
          ? '완료'
          : `${progress}/${c.goal_count} 진행 중`
        : `${participantCount.toLocaleString()}명 참가 중 · 시작 전`);

    return {
      id: c.id,
      title: c.title,
      meta,
      progress,
      goalCount: c.goal_count,
      progressLabel: `${progress}/${c.goal_count}`,
      participantCount,
      joined,
      completed,
    };
  });
}

export async function fetchGlobalLeaderboard(
  limit = 20,
): Promise<LeaderboardEntry[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) {
    return [];
  }

  await ensureAnonymousUserId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user?.id ?? null;

  const { data, error } = await supabase.rpc('get_global_leaderboard', {
    limit_count: limit,
  });

  if (error || !data) {
    console.warn('[fetchGlobalLeaderboard]', error?.message);
    return [];
  }

  return (
    data as {
      rank: number;
      user_id: string;
      display_name: string;
      score: number;
      rank_delta: number | null;
    }[]
  ).map((row) => ({
    rank: Number(row.rank),
    userId: row.user_id,
    displayName: row.display_name,
    score: Number(row.score),
    rankDelta: row.rank_delta,
    isMe: me != null && row.user_id === me,
  }));
}

export async function fetchLeagueMe(): Promise<LeagueMeState | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) {
    return null;
  }

  const userId = await ensureAnonymousUserId();
  if (!userId) {
    return null;
  }

  const { data: season, error } = await supabase
    .from('league_seasons')
    .select('id, name, start_at, end_at, tier_thresholds, is_active')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !season) {
    console.warn('[fetchLeagueMe]', error?.message);
    return null;
  }

  const seasonRow: LeagueSeasonRow = {
    id: season.id,
    name: season.name,
    start_at: season.start_at,
    end_at: season.end_at,
    tier_thresholds: (season.tier_thresholds ?? {}) as Record<string, number>,
    is_active: season.is_active,
  };

  const { data: existing } = await supabase
    .from('user_league_progress')
    .select('id, tier, points')
    .eq('user_id', userId)
    .eq('season_id', seasonRow.id)
    .maybeSingle();

  let points = existing?.points ?? 0;
  let tier =
    existing?.tier ?? resolveTier(points, seasonRow.tier_thresholds);

  if (!existing) {
    const resolved = resolveTier(0, seasonRow.tier_thresholds);
    const { error: insertError } = await supabase
      .from('user_league_progress')
      .insert({
        user_id: userId,
        season_id: seasonRow.id,
        tier: resolved,
        points: 0,
      });
    if (insertError) {
      console.warn('[fetchLeagueMe] insert', insertError.message);
    }
    points = 0;
    tier = resolved;
  }

  const thresholds = seasonRow.tier_thresholds;
  const tierIndex = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  const nextTier =
    tierIndex >= 0 && tierIndex < TIER_ORDER.length - 1
      ? TIER_ORDER[tierIndex + 1]
      : null;
  const nextMin = nextTier != null ? thresholds[nextTier] : null;
  const currentMin = thresholds[tier] ?? 0;
  const pointsToNext =
    nextMin != null ? Math.max(0, nextMin - points) : null;
  const span =
    nextMin != null ? Math.max(1, nextMin - currentMin) : 1;
  const progressInTier =
    nextMin != null
      ? Math.min(1, Math.max(0, (points - currentMin) / span))
      : 1;

  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(seasonRow.end_at).getTime() - Date.now()) /
        (24 * 60 * 60 * 1000),
    ),
  );

  return {
    season: seasonRow,
    tier,
    points,
    nextTier,
    pointsToNext,
    progressInTier,
    daysLeft,
    tiers: [...TIER_ORDER],
  };
}

const LEAGUE_POINTS_PER_SESSION = 10;

/**
 * 세션·리포트 저장 직후: target_issue === patternId 미션 progress +1,
 * 활성 시즌 리그 포인트 가산. cron 없음.
 */
export async function bumpProgressAfterSession(input: {
  userId: string;
  patternId: DiagnosisPatternId;
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || !isSupabaseConfigured()) {
    return;
  }

  if (input.patternId !== 'overall_good') {
    const { data: related } = await supabase
      .from('challenges')
      .select('id, goal_count')
      .eq('type', 'mission')
      .eq('is_active', true)
      .eq('target_issue', input.patternId);

    for (const challenge of related ?? []) {
      const { data: existing } = await supabase
        .from('user_challenges')
        .select('id, progress, completed_at')
        .eq('user_id', input.userId)
        .eq('challenge_id', challenge.id)
        .maybeSingle();

      if (existing?.completed_at) {
        continue;
      }

      const nextProgress = Math.min(
        challenge.goal_count,
        (existing?.progress ?? 0) + 1,
      );
      const completed =
        nextProgress >= challenge.goal_count
          ? new Date().toISOString()
          : null;

      if (existing) {
        await supabase
          .from('user_challenges')
          .update({
            progress: nextProgress,
            completed_at: completed,
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('user_challenges').insert({
          user_id: input.userId,
          challenge_id: challenge.id,
          progress: nextProgress,
          completed_at: completed,
        });
      }
    }
  }

  const { data: season } = await supabase
    .from('league_seasons')
    .select('id, tier_thresholds')
    .eq('is_active', true)
    .maybeSingle();

  if (!season) {
    return;
  }

  const thresholds = (season.tier_thresholds ?? {}) as Record<string, number>;
  const { data: prog } = await supabase
    .from('user_league_progress')
    .select('id, points')
    .eq('user_id', input.userId)
    .eq('season_id', season.id)
    .maybeSingle();

  const nextPoints = (prog?.points ?? 0) + LEAGUE_POINTS_PER_SESSION;
  const nextTier = resolveTier(nextPoints, thresholds);

  if (prog) {
    await supabase
      .from('user_league_progress')
      .update({
        points: nextPoints,
        tier: nextTier,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prog.id);
  } else {
    await supabase.from('user_league_progress').insert({
      user_id: input.userId,
      season_id: season.id,
      points: nextPoints,
      tier: nextTier,
    });
  }
}
