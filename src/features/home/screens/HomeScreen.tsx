/**
 * 홈 탭 — swing_reports / drills / user_challenges 실데이터.
 */

import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  fetchHomeDashboard,
  type HomeDashboard,
} from '@/services/supabase/homeDashboard';

const EMPTY_DASH: HomeDashboard = {
  overallScore: null,
  statusLabel: 'NO REPORT YET',
  statusTone: 'empty',
  heroDesc:
    '아직 스윙 리포트가 없어요.\n실시간 촬영이나 영상 업로드로 시작해 보세요.',
  joints: [
    { label: '허리', value: null, warn: false },
    { label: '손목', value: null, warn: false },
    { label: '무릎', value: null, warn: false },
  ],
  recentReports: [],
  drill: null,
  drillFallback: '리포트가 쌓이면 맞춤 드릴을 추천해 드려요.',
  challenge: null,
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { profile, user } = useAuth();
  const [dash, setDash] = useState<HomeDashboard>(EMPTY_DASH);
  const [loading, setLoading] = useState(true);

  const displayName =
    profile?.name?.trim() ||
    user?.email?.split('@')[0] ||
    '골퍼';
  const initial = displayName.slice(0, 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchHomeDashboard();
      setDash(next);
    } catch (e) {
      console.warn('[HomeScreen]', e);
      setDash(EMPTY_DASH);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const statusColor =
    dash.statusTone === 'good'
      ? '#3FBF8F'
      : dash.statusTone === 'caution'
        ? '#E5A85D'
        : dash.statusTone === 'warn'
          ? '#FF758C'
          : '#7A8198';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.aurora, styles.auroraA]} />
      <View style={[styles.aurora, styles.auroraB]} />
      <View style={[styles.aurora, styles.auroraC]} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + BottomTabInset + 28,
        }}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.profilePic}>
              <Text style={styles.profilePicText}>{initial}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="알림"
              onPress={() => Alert.alert('알림', '준비 중입니다')}
              style={styles.bellBtn}
            >
              <SymbolView
                name={{
                  ios: 'bell',
                  android: 'notifications',
                  web: 'notifications',
                }}
                size={16}
                tintColor="#232630"
                weight="medium"
                fallback={<Text style={styles.bellFallback}>N</Text>}
              />
            </Pressable>
          </View>
          <Text style={styles.headerName}>Est. for {displayName} · Member</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTag}>SWING BALANCE, TODAY</Text>
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color="#8971EA" />
          ) : (
            <>
              <Text style={styles.heroScore}>
                {dash.overallScore != null ? dash.overallScore : '—'}
              </Text>
              <Text style={[styles.heroStatus, { color: statusColor }]}>
                {dash.statusLabel}
              </Text>
              <Text style={styles.heroDesc}>{dash.heroDesc}</Text>
            </>
          )}
        </View>

        <View style={styles.statsRow}>
          {dash.joints.map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={[styles.statVal, s.warn && styles.statWarn]}>
                {s.value != null ? s.value : '—'}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/capture?mode=live')}
            style={({ pressed }) => [
              styles.btn,
              styles.btnPrimary,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.btnPrimaryText}>실시간 촬영</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/capture?mode=upload')}
            style={({ pressed }) => [
              styles.btn,
              styles.btnSecondary,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.btnSecondaryText}>영상 업로드</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.sectionTitle}>최근 리포트</Text>
            <Text style={styles.sectionSub}>Recent Rounds</Text>
          </View>
          <Pressable onPress={() => router.push('/explore')}>
            <Text style={styles.link}>전체보기</Text>
          </Pressable>
        </View>

        {!loading && dash.recentReports.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 리포트가 없어요</Text>
            <Text style={styles.emptyMeta}>
              첫 스윙을 기록하면 여기에 최근 분석이 보여요
            </Text>
          </View>
        ) : (
          dash.recentReports.map((r, index) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              onPress={() => router.push(`/report/${r.sessionId}`)}
              style={[styles.gcard, index > 0 && styles.gcardDim]}
            >
              <Text style={[styles.gcardTag, { color: r.tagColor }]}>
                {r.tag}
              </Text>
              <Text style={styles.gcardTitle}>{r.title}</Text>
              <Text style={styles.gcardMeta}>{r.meta}</Text>
            </Pressable>
          ))
        )}

        <View style={[styles.sectionHead, { marginTop: 6 }]}>
          <View>
            <Text style={styles.sectionTitle}>추천 드릴</Text>
            <Text style={styles.sectionSub}>Recommended</Text>
          </View>
        </View>

        {dash.drill ? (
          <View style={styles.gcard}>
            <Text style={[styles.gcardTag, { color: '#6C56D6' }]}>
              {dash.drill.category ?? 'Drill'}
            </Text>
            <Text style={styles.gcardTitle}>{dash.drill.name}</Text>
            <Text style={styles.gcardMeta}>
              {dash.drill.description ?? ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(
                  '드릴',
                  '드릴 가이드 화면은 곧 연결됩니다. 지금은 추천만 확인할 수 있어요.',
                )
              }
              style={({ pressed }) => [
                styles.btnAccent,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.btnAccentText}>시작하기</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>추천 드릴</Text>
            <Text style={styles.emptyMeta}>
              {dash.drillFallback ??
                '리포트가 쌓이면 맞춤 드릴을 추천해 드려요.'}
            </Text>
          </View>
        )}

        {dash.challenge ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/challenge')}
            style={[styles.gcard, { marginTop: 6 }]}
          >
            <Text style={styles.gcardTag}>
              Challenge · {dash.challenge.progressLabel}
            </Text>
            <Text style={styles.gcardTitle}>{dash.challenge.title}</Text>
            <Text style={styles.gcardMeta}>{dash.challenge.meta}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FDFDFD',
  },
  aurora: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.45,
  },
  auroraA: {
    width: 280,
    height: 280,
    backgroundColor: '#E0C3FC',
    top: -40,
    left: -100,
  },
  auroraB: {
    width: 260,
    height: 260,
    backgroundColor: '#C2E9FB',
    top: '22%',
    right: -110,
  },
  auroraC: {
    width: 240,
    height: 240,
    backgroundColor: '#FFD3E0',
    bottom: '18%',
    left: -80,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 18,
  },
  headerTop: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 11,
  },
  profilePic: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#A18CD1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  profilePicText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  bellBtn: {
    position: 'absolute',
    right: 0,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellFallback: {
    fontSize: 12,
    fontWeight: '700',
    color: '#232630',
  },
  headerName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#7A8198',
  },
  hero: {
    marginHorizontal: 20,
    marginBottom: 22,
    paddingVertical: 30,
    paddingHorizontal: 20,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
  },
  heroTag: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7A8198',
    letterSpacing: 0.5,
  },
  heroScore: {
    fontSize: 68,
    fontWeight: '800',
    color: '#2D3142',
    marginVertical: 4,
    letterSpacing: -2,
  },
  heroStatus: {
    fontSize: 12,
    fontWeight: '800',
    color: '#E5A85D',
    marginBottom: 14,
    letterSpacing: 0.5,
  },
  heroDesc: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#232630',
    lineHeight: 21,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 34,
    marginBottom: 26,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#7A8198',
    marginBottom: 6,
  },
  statVal: {
    fontSize: 24,
    fontWeight: '800',
    color: '#232630',
  },
  statWarn: {
    color: '#FF758C',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 28,
  },
  btn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: '#2D3142',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  btnSecondaryText: {
    color: '#232630',
    fontSize: 13.5,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginHorizontal: 24,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#232630',
  },
  sectionSub: {
    fontSize: 11.5,
    color: '#7A8198',
    marginTop: 2,
    fontWeight: '600',
  },
  link: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#232630',
  },
  gcard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  gcardDim: {
    opacity: 0.72,
  },
  gcardTag: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#FF758C',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 9,
  },
  gcardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#232630',
    marginBottom: 5,
    lineHeight: 21,
  },
  gcardMeta: {
    fontSize: 11.5,
    color: '#7A8198',
    fontWeight: '600',
  },
  btnAccent: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderRadius: 14,
    backgroundColor: '#8971EA',
  },
  btnAccentText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
    borderStyle: 'dashed',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#232630',
    marginBottom: 6,
  },
  emptyMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 18,
  },
});
