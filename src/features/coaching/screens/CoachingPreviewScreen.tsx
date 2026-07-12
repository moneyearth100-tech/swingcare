/**
 * 코칭 클립 미리보기 — draft. 「이 구간이 맞나요?」→ 코치 선택.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createCoachingClipSignedUrl,
  fetchCoachingRequest,
} from '../../../services/supabase/coaching';

export default function CoachingPreviewScreen() {
  const insets = useSafeAreaInsets();
  const { requestId: raw } = useLocalSearchParams<{ requestId?: string }>();
  const requestId = Array.isArray(raw) ? raw[0] : raw;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [patternId, setPatternId] = useState<string | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
  });

  const load = useCallback(async () => {
    if (!requestId) {
      setError('요청 ID가 없어요');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const row = await fetchCoachingRequest(requestId);
    if (!row) {
      setError('요청을 찾을 수 없어요');
      setLoading(false);
      return;
    }
    if (row.status !== 'draft') {
      setError('이미 전송된 요청이에요');
      setLoading(false);
      return;
    }
    setSummary(row.diagnosis_summary);
    setPhase(row.issue_phase);
    setPatternId(row.diagnosis_pattern_id);
    if (!row.clip_url) {
      setError('클립이 아직 준비되지 않았어요');
      setLoading(false);
      return;
    }
    const url = await createCoachingClipSignedUrl(row.clip_url);
    if (!url) {
      setError('클립 URL을 만들지 못했어요');
      setLoading(false);
      return;
    }
    setSignedUrl(url);
    setLoading(false);
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!signedUrl || !player) {
      return;
    }
    try {
      player.replace(signedUrl);
      player.play();
    } catch (e) {
      console.warn('[CoachingPreview] replace', e);
    }
  }, [signedUrl, player]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>클립 미리보기</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#8971EA" />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !error && signedUrl ? (
        <>
          <Text style={styles.question}>이 구간이 맞나요?</Text>
          <Text style={styles.meta}>
            {phase ? `구간 · ${phase}` : '문제 구간 클립'} · 약 8초
          </Text>
          <View style={styles.stage}>
            <VideoView
              style={StyleSheet.absoluteFill}
              player={player}
              contentFit="contain"
              nativeControls
            />
          </View>
          {summary ? <Text style={styles.summary}>{summary}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({
                pathname: '/coaching/select-coach',
                params: {
                  requestId: requestId!,
                  patternId: patternId ?? '',
                },
              });
            }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>맞아요 · 코치 선택하기</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={styles.secondary}>
            <Text style={styles.secondaryText}>다시 고를게요</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#11131A', paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { color: '#fff', fontSize: 28, fontWeight: '300' },
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  question: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  meta: { color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginBottom: 12 },
  stage: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 420,
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden',
  },
  summary: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  cta: {
    marginTop: 18,
    backgroundColor: '#8971EA',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondary: { marginTop: 12, alignItems: 'center', padding: 10 },
  secondaryText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700' },
  error: {
    marginTop: 24,
    color: '#FF8A80',
    textAlign: 'center',
    fontWeight: '600',
  },
});
