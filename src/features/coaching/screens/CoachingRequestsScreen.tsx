/**
 * 내 코칭 요청 목록 (마이 탭 진입).
 */

import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import {
  fetchMyCoachingRequests,
  type CoachingRequestRow,
} from '../../../services/supabase/coaching';

const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  pending: '대기',
  accepted: '수락',
  in_review: '진행 중',
  completed: '완료',
  canceled: '취소',
  expired: '만료',
};

export default function CoachingRequestsScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<CoachingRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await fetchMyCoachingRequests());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>코칭 요청</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <ActivityIndicator color="#8971EA" /> : null}

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + BottomTabInset + 24,
        }}
      >
        {!loading && rows.length === 0 ? (
          <Text style={styles.empty}>
            아직 요청이 없어요. 업로드 스윙 리포트에서 코치에게 보내기를 시작해
            보세요.
          </Text>
        ) : null}
        {rows.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.status}>
                {STATUS_LABEL[r.status] ?? r.status}
              </Text>
              <Text style={styles.date}>
                {new Date(r.created_at).toLocaleString('ko-KR')}
              </Text>
            </View>
            <Text style={styles.phase}>{r.issue_phase ?? '구간 —'}</Text>
            <Text style={styles.summary} numberOfLines={3}>
              {r.diagnosis_summary ?? ''}
            </Text>
            {r.coach_reply_text ? (
              <Text style={styles.reply}>코치 답변: {r.coach_reply_text}</Text>
            ) : null}
            {r.status === 'draft' ? (
              <Pressable
                onPress={() =>
                  router.push(`/coaching/preview/${r.id}`)
                }
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>미리보기 이어가기</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
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
  empty: {
    marginTop: 40,
    marginHorizontal: 24,
    textAlign: 'center',
    color: '#7A8198',
    fontWeight: '600',
    lineHeight: 20,
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  status: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8971EA',
    textTransform: 'uppercase',
  },
  date: { fontSize: 11, fontWeight: '600', color: '#9AA1B5' },
  phase: { fontSize: 14, fontWeight: '800', color: '#232630' },
  summary: {
    marginTop: 6,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#4A5065',
    lineHeight: 18,
  },
  reply: {
    marginTop: 10,
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2F6BFF',
    lineHeight: 18,
  },
  linkBtn: { marginTop: 10 },
  linkText: { fontSize: 13, fontWeight: '800', color: '#8971EA' },
});
