/**
 * 챌린지 탭 — 친구 랭킹만 표시.
 */

import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { useChallengeTabData } from '@/features/challenge/hooks/useChallengeData';

export default function ChallengeScreen() {
  const insets = useSafeAreaInsets();
  const { leaderboard, loading, error } = useChallengeTabData();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topbar}>
        <Text style={styles.screenTitle}>랭킹</Text>
        <Text style={styles.screenSub}>함께할수록 더 늘어요</Text>
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

        {!loading ? (
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
