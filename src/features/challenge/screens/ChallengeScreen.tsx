/**
 * 챌린지 탭 — 랭킹/시즌리그/미션 (실데이터 훅).
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { useChallengeTabData } from '@/features/challenge/hooks/useChallengeData';
import { tierLabelKo } from '@/services/supabase/challenges';

type ChallengePanel = 'rank' | 'league' | 'mission';

export default function ChallengeScreen() {
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<ChallengePanel>('rank');
  const { leaderboard, league, missions, loading, error } =
    useChallengeTabData();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topbar}>
        <Text style={styles.screenTitle}>챌린지</Text>
        <Text style={styles.screenSub}>함께할수록 더 늘어요</Text>
      </View>

      <View style={styles.segmented}>
        {(
          [
            { id: 'rank' as const, label: '친구 랭킹' },
            { id: 'league' as const, label: '시즌 리그' },
            { id: 'mission' as const, label: '챌린지' },
          ] as const
        ).map((item) => {
          const active = panel === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setPanel(item.id)}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  active && styles.segmentLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + BottomTabInset + 24,
          paddingTop: 8,
        }}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color="#8971EA" />
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading && panel === 'rank' ? (
          <View style={styles.panel}>
            {leaderboard.length === 0 ? (
              <Text style={styles.emptyHint}>
                아직 랭킹 점수가 없어요. 스윙을 저장하면 반영됩니다.
              </Text>
            ) : (
              leaderboard.map((row) => (
                <View
                  key={row.userId}
                  style={[styles.rankItem, row.isMe && styles.rankItemMe]}
                >
                  <Text style={styles.rankNum}>{row.rank}</Text>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(row.isMe ? '나' : row.displayName).slice(0, 1)}
                    </Text>
                  </View>
                  <Text style={styles.rankName}>
                    {row.isMe ? `나 (${row.displayName})` : row.displayName}
                  </Text>
                  <Text style={styles.rankScore}>
                    {Math.round(row.score)}
                  </Text>
                  <Text style={styles.rankDelta}>–</Text>
                </View>
              ))
            )}
            <Text style={styles.hint}>
              글로벌 랭킹 · 최신 밸런스 지수 기준
            </Text>
          </View>
        ) : null}

        {!loading && panel === 'league' ? (
          <View style={styles.panel}>
            {league == null ? (
              <Text style={styles.emptyHint}>활성 시즌이 없습니다.</Text>
            ) : (
              <>
                <View style={styles.tierCard}>
                  <Text style={styles.tierName}>
                    {tierLabelKo(league.tier)} 티어
                  </Text>
                  <Text style={styles.tierMeta}>
                    {league.nextTier != null && league.pointsToNext != null
                      ? `${tierLabelKo(league.nextTier)} 티어까지 ${league.pointsToNext}P 남았어요`
                      : '최고 티어예요'}
                  </Text>
                  <View style={styles.tierBarTrack}>
                    <View
                      style={[
                        styles.tierBarFill,
                        {
                          width: `${Math.round(league.progressInTier * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.tierFoot}>
                    {league.season.name} · 종료까지 {league.daysLeft}일 ·{' '}
                    {league.points}P
                  </Text>
                </View>
                <View style={styles.tierList}>
                  {league.tiers.map((tier) => {
                    const current = tier === league.tier;
                    return (
                      <View
                        key={tier}
                        style={[
                          styles.tierPill,
                          current && styles.tierPillCurrent,
                        ]}
                      >
                        <Text
                          style={[
                            styles.tierPillText,
                            current && styles.tierPillTextCurrent,
                          ]}
                        >
                          {`${tierLabelKo(tier)}\n티어`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </View>
        ) : null}

        {!loading && panel === 'mission' ? (
          <View style={styles.panel}>
            {missions.length === 0 ? (
              <Text style={styles.emptyHint}>
                진행 가능한 챌린지가 없습니다.
              </Text>
            ) : (
              missions.map((mission) => (
                <View key={mission.id} style={styles.challengeCard}>
                  <View
                    style={[
                      styles.progressRing,
                      {
                        backgroundColor:
                          mission.progress > 0
                            ? 'rgba(255,117,140,0.35)'
                            : 'rgba(122,129,152,0.15)',
                      },
                    ]}
                  >
                    <View style={styles.progressHole}>
                      <Text style={styles.progressHoleText}>
                        {mission.progressLabel}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.challengeText}>
                    <Text style={styles.challengeTitle}>{mission.title}</Text>
                    <Text style={styles.challengeMeta}>{mission.meta}</Text>
                  </View>
                  {mission.participantCount > 0 ? (
                    <Text style={styles.friendMore}>
                      {mission.participantCount > 999
                        ? `+${(mission.participantCount / 1000).toFixed(1)}K`
                        : `${mission.participantCount}명`}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
            <Text style={styles.hint}>
              세션 저장 시 patternId ≡ target_issue 면 진행도 +1
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' },
  topbar: { paddingHorizontal: 20, marginBottom: 12 },
  screenTitle: { fontSize: 26, fontWeight: '800', color: '#1A2333' },
  screenSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
    marginTop: 4,
  },
  segmented: {
    flexDirection: 'row',
    marginHorizontal: 20,
    padding: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(122,129,152,0.12)',
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: '#FFFFFF' },
  segmentLabel: { fontSize: 12, fontWeight: '700', color: '#7A8198' },
  segmentLabelActive: { color: '#1A2333' },
  panel: { paddingTop: 12 },
  rankItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
  },
  rankItemMe: {
    backgroundColor: 'rgba(137,113,234,0.12)',
    borderColor: 'rgba(137,113,234,0.3)',
  },
  rankNum: {
    fontSize: 12,
    fontWeight: '800',
    color: '#9AA1B5',
    width: 14,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#8971EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  rankName: { flex: 1, fontSize: 13, fontWeight: '700', color: '#232630' },
  rankScore: { fontSize: 14, fontWeight: '800', color: '#232630' },
  rankDelta: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#9AA1B5',
    width: 26,
    textAlign: 'right',
  },
  tierCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingVertical: 26,
    paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: '#1B1F2A',
    alignItems: 'center',
  },
  tierName: { fontSize: 22, fontWeight: '800', color: '#F3D98A' },
  tierMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.65)',
    marginTop: 6,
    textAlign: 'center',
  },
  tierBarTrack: {
    marginTop: 16,
    height: 8,
    width: '100%',
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  tierBarFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#F3D98A',
  },
  tierFoot: {
    marginTop: 12,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  tierList: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
  },
  tierPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
  },
  tierPillCurrent: { backgroundColor: '#1B1F2A', borderColor: 'transparent' },
  tierPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#7A8198',
    textAlign: 'center',
    lineHeight: 14,
  },
  tierPillTextCurrent: { color: '#fff' },
  challengeCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
  },
  progressRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressHole: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FDFDFD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressHoleText: { fontSize: 10.5, fontWeight: '800', color: '#232630' },
  challengeText: { flex: 1 },
  challengeTitle: { fontSize: 13.5, fontWeight: '700', color: '#232630' },
  challengeMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7A8198',
    marginTop: 3,
  },
  friendMore: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7A8198',
  },
  emptyHint: {
    marginTop: 24,
    marginHorizontal: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
  },
  hint: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: '#9AA1B5',
  },
  errorText: {
    marginTop: 16,
    textAlign: 'center',
    color: '#FF758C',
    fontWeight: '600',
  },
});
