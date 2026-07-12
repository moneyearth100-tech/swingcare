/**
 * 코치 리스트 → 선택 → 「코치에게 보내기」(pending).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import {
  assignCoachToRequest,
  fetchActiveCoaches,
  sendCoachingRequest,
  type CoachRow,
} from '../../../services/supabase/coaching';

function guardText(s: string): string {
  return s.replace(/부상|위험|진단/g, '참고');
}

export default function CoachingSelectCoachScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    requestId?: string;
    patternId?: string;
  }>();
  const requestId = typeof params.requestId === 'string' ? params.requestId : null;
  const patternId =
    typeof params.patternId === 'string' && params.patternId.length > 0
      ? params.patternId
      : null;

  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await fetchActiveCoaches(patternId);
    setCoaches(rows);
    setLoading(false);
  }, [patternId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSend = async () => {
    if (!requestId || !selected || busy) {
      return;
    }
    setBusy(true);
    try {
      const assigned = await assignCoachToRequest(requestId, selected);
      if (!assigned.ok) {
        Alert.alert('실패', assigned.message ?? '코치 지정에 실패했어요');
        return;
      }
      const sent = await sendCoachingRequest(requestId);
      if (!sent.ok) {
        Alert.alert('실패', sent.message ?? '전송에 실패했어요');
        return;
      }
      Alert.alert('전송 완료', '코치에게 요청을 보냈어요.', [
        {
          text: '내 요청 보기',
          onPress: () => router.replace('/coaching/requests'),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>코치 선택</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <ActivityIndicator color="#8971EA" /> : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {coaches.map((c) => {
          const match =
            patternId != null && (c.specialties ?? []).includes(patternId);
          const active = selected === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => setSelected(c.id)}
              style={[styles.card, active && styles.cardActive]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.name}>{c.name}</Text>
                {match ? (
                  <Text style={styles.match}>추천</Text>
                ) : null}
              </View>
              <Text style={styles.meta}>
                ★ {Number(c.rating).toFixed(1)} · 응답 약{' '}
                {c.avg_response_hours != null
                  ? `${c.avg_response_hours}h`
                  : '—'}{' '}
                · ₩{c.price_krw.toLocaleString()}
              </Text>
              {c.bio ? (
                <Text style={styles.bio}>{guardText(c.bio)}</Text>
              ) : null}
            </Pressable>
          );
        })}
        {!loading && coaches.length === 0 ? (
          <Text style={styles.empty}>
            등록된 코치가 없어요. 관리자가 coaches를 시드해 주세요.
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          disabled={!selected || busy}
          onPress={() => {
            void onSend();
          }}
          style={[styles.cta, (!selected || busy) && styles.ctaDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>코치에게 보내기</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { fontSize: 28, fontWeight: '300', color: '#232630' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#1A2333',
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.1)',
  },
  cardActive: {
    borderColor: '#8971EA',
    backgroundColor: 'rgba(137,113,234,0.08)',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: { fontSize: 15, fontWeight: '800', color: '#232630' },
  match: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8971EA',
    backgroundColor: 'rgba(137,113,234,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  meta: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
  },
  bio: {
    marginTop: 8,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#4A5065',
    lineHeight: 18,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    color: '#7A8198',
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(244,247,251,0.96)',
  },
  cta: {
    backgroundColor: '#2D3142',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
