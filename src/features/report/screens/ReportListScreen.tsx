/**
 * 리포트 탭 — pending 업로드 + 완료 리포트 피드.
 * pending/processing 이 있으면 주기적으로 폴링 (서버 분석 완료 반영).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import {
  fetchReportFeed,
  type ReportFeedItem,
} from '@/services/supabase/reportFeed';

const PENDING_POLL_MS = 4000;

export default function ReportListScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ReportFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const focusedRef = useRef(false);

  const reload = useCallback(async (mode: 'full' | 'silent' | 'pull' = 'full') => {
    if (mode === 'full') {
      setLoading(true);
    }
    if (mode === 'pull') {
      setRefreshing(true);
    }
    try {
      const feed = await fetchReportFeed(40);
      setItems(feed);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void reload('full');
      return () => {
        focusedRef.current = false;
      };
    }, [reload]),
  );

  const hasInFlight = items.some(
    (item) => item.kind === 'pending' || item.kind === 'error',
  );
  // Also poll when list empty after upload? No — poll while pending/processing only.
  const hasPending = items.some((item) => item.kind === 'pending');

  useEffect(() => {
    if (!hasPending) {
      return;
    }
    const id = setInterval(() => {
      if (!focusedRef.current) {
        return;
      }
      void reload('silent');
    }, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [hasPending, reload]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={[styles.aurora, styles.auroraB]} />
      <View style={[styles.aurora, styles.auroraC]} />

      <View style={styles.topbar}>
        <View style={styles.topbarRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>리포트</Text>
            <Text style={styles.screenSub}>지금까지의 스윙 변화를 확인해요</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void reload('pull')}
            style={({ pressed }) => [styles.refreshBtn, pressed && styles.pressed]}
          >
            <Text style={styles.refreshBtnText}>새로고침</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reload('pull')}
            tintColor="#8971EA"
          />
        }
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: insets.bottom + BottomTabInset + 24,
        }}
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 28 }} color="#8971EA" />
        ) : null}

        {!loading && items.length === 0 ? (
          <Text style={styles.empty}>
            아직 리포트가 없어요. 촬영하거나 영상을 업로드해 보세요.
          </Text>
        ) : null}

        {!loading && hasInFlight ? (
          <Text style={styles.hint}>
            분석이 끝나면 자동으로 새로고침돼요. 당겨서 새로고침도 가능해요.
          </Text>
        ) : null}

        {items.map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={() => {
              if (r.kind === 'pending') {
                void reload('silent');
                Alert.alert(
                  '분석 중',
                  r.status === 'processing'
                    ? '서버에서 영상을 분석하고 있어요. 잠시만 기다려 주세요.'
                    : '분석 대기열에 들어갔어요. 잠시만 기다려 주세요.',
                );
                return;
              }
              if (r.kind === 'error') {
                Alert.alert(
                  '분석 실패',
                  '서버 분석에 실패했어요. 영상을 다시 업로드해 주세요.',
                );
                return;
              }
              router.push(`/report/${r.sessionId}`);
            }}
            style={({ pressed }) => [styles.gcard, pressed && styles.pressed]}
          >
            <View style={styles.gcardTop}>
              <Text style={[styles.gcardTag, { color: r.tagColor }]}>
                {r.tag}
              </Text>
              {r.hasVideo ? (
                <View style={styles.videoBadge}>
                  <Text style={styles.videoBadgeText}>▶ 동영상</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.gcardTitle}>{r.title}</Text>
            <Text style={styles.gcardMeta}>{r.meta}</Text>
          </Pressable>
        ))}
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
  auroraB: {
    width: 260,
    height: 260,
    backgroundColor: '#C2E9FB',
    top: '18%',
    right: -110,
  },
  auroraC: {
    width: 240,
    height: 240,
    backgroundColor: '#FFD3E0',
    bottom: '22%',
    left: -80,
  },
  topbar: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    zIndex: 1,
  },
  topbarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#232630',
  },
  screenSub: {
    fontSize: 12.5,
    color: '#7A8198',
    marginTop: 3,
    fontWeight: '600',
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(137,113,234,0.12)',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8971EA',
  },
  empty: {
    marginTop: 24,
    marginHorizontal: 28,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
  },
  hint: {
    marginHorizontal: 24,
    marginBottom: 10,
    fontSize: 12,
    fontWeight: '600',
    color: '#E5A85D',
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
  pressed: {
    opacity: 0.85,
  },
  gcardTag: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  gcardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 9,
  },
  videoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(45,49,66,0.92)',
  },
  videoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
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
});
