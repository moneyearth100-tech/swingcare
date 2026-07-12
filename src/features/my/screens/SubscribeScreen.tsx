/**
 * 구독 플랜 비교. 프리미엄 결제는 FEATURE_FLAGS.PREMIUM_CHECKOUT 전까지 차단.
 */

import { router } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isFeatureEnabled } from '@/constants/featureFlags';

export default function SubscribeScreen() {
  const insets = useSafeAreaInsets();
  const checkoutEnabled = isFeatureEnabled('PREMIUM_CHECKOUT');

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/my');
            }
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>플랜 선택</Text>
        <View style={styles.backSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 28,
        }}
      >
        <Text style={styles.lead}>
          지금보다 더 정확하게, 더 안전하게 스윙을 관리해보세요.
        </Text>

        <View style={styles.compare}>
          <View style={styles.planBox}>
            <Text style={styles.planName}>무료</Text>
            <Text style={styles.planPrice}>₩0</Text>
            <Text style={styles.planItem}>· 기본 촬영 · 분석</Text>
            <Text style={styles.planItem}>· AI 기본 리포트</Text>
            <Text style={styles.planItem}>· 리포트 3개 저장</Text>
          </View>
          <View style={[styles.planBox, styles.planPremium]}>
            <Text style={[styles.planName, styles.planNamePremium]}>
              프리미엄
            </Text>
            <Text style={styles.planPrice}>₩12,900</Text>
            <Text style={styles.planItem}>· 밸런스 지수 상세 분석</Text>
            <Text style={styles.planItem}>· Live AR 스윙 가이드</Text>
            <Text style={styles.planItem}>· 무제한 리포트 저장</Text>
            <Text style={styles.planItem}>· 스크린골프 연동</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !checkoutEnabled }}
          disabled={!checkoutEnabled}
          onPress={() => {
            // PREMIUM_CHECKOUT 켜진 뒤에만 RevenueCat 결제 연결
          }}
          style={[styles.cta, !checkoutEnabled && styles.ctaDisabled]}
        >
          <Text style={styles.ctaLabel}>
            {checkoutEnabled ? '프리미엄 시작하기' : '프리미엄 출시 예정'}
          </Text>
        </Pressable>
        <Text style={styles.footnote}>
          {checkoutEnabled
            ? '결제는 앱스토어 구독으로 진행됩니다.'
            : '세부 지표 분석·AR 가이드 등 프리미엄 콘텐츠가 준비되면 결제가 열립니다. 지금은 무료로 이용할 수 있어요.'}
        </Text>
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
    paddingBottom: 10,
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
    fontSize: 17,
    fontWeight: '800',
    color: '#1A2333',
  },
  backSpacer: { width: 40 },
  lead: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 21,
    marginBottom: 18,
  },
  compare: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  planBox: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.1)',
    gap: 6,
  },
  planPremium: {
    borderColor: 'rgba(47,107,255,0.35)',
    backgroundColor: 'rgba(47,107,255,0.06)',
  },
  planName: { fontSize: 13, fontWeight: '800', color: '#7A8198' },
  planNamePremium: { color: '#2F6BFF' },
  planPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: '#232630',
    marginBottom: 4,
  },
  planItem: { fontSize: 11.5, fontWeight: '600', color: '#4A5065' },
  cta: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F6BFF',
  },
  ctaDisabled: {
    backgroundColor: '#A7ADBD',
  },
  ctaLabel: { fontSize: 14, fontWeight: '800', color: '#fff' },
  footnote: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 18,
    textAlign: 'center',
  },
});
