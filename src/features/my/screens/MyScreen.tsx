/**
 * 마이 탭 — 프로필·구독 실데이터, 메뉴 feature flag.
 * 스크린골프·장비핏은 FEATURE_FLAGS 로 비노출 (코드 유지).
 * 코칭 마켓은 노출하되 스키마 승인 전 안내.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isFeatureEnabled } from '@/constants/featureFlags';
import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  AGE_GROUP_OPTIONS,
  INJURY_HISTORY_OPTIONS,
} from '@/features/auth/lib/profileTypes';
import {
  fetchMySubscription,
  type SubscriptionState,
} from '@/services/supabase/subscriptions';

type MenuItem = {
  id: string;
  label: string;
  badge: string | null;
  visible: boolean;
  onPress: () => void;
};

export default function MyScreen() {
  const insets = useSafeAreaInsets();
  const { profile, user } = useAuth();
  const [sub, setSub] = useState<SubscriptionState>({
    plan: 'free',
    status: 'active',
    isPremium: false,
    revenuecatLinked: false,
    currentPeriodEnd: null,
  });

  const displayName =
    profile?.name?.trim() ||
    user?.email?.split('@')[0] ||
    '골퍼';
  const initial = displayName.slice(0, 1);
  const handicap =
    profile?.handicap != null ? `핸디캡 ${profile.handicap}` : '핸디캡 —';
  const ageLabel =
    AGE_GROUP_OPTIONS.find((o) => o.id === profile?.age_group)?.label ?? null;
  const injuryLabels = (profile?.injury_history ?? [])
    .map(
      (code) =>
        INJURY_HISTORY_OPTIONS.find((o) => o.id === code)?.label ?? null,
    )
    .filter((v): v is string => v != null);

  const loadSub = useCallback(async () => {
    try {
      setSub(await fetchMySubscription());
    } catch (e) {
      console.warn('[MyScreen] subscription', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSub();
    }, [loadSub]),
  );

  const menuItems: MenuItem[] = [
    {
      id: 'coaching',
      label: '하이브리드 코칭 마켓',
      badge: null,
      visible: true,
      onPress: () => router.push('/coaching/requests'),
    },
    {
      id: 'equipment',
      label: '장비 핏 추천',
      badge: null,
      visible: isFeatureEnabled('EQUIPMENT_FIT_MENU'),
      onPress: () => Alert.alert('알림', '준비 중입니다'),
    },
    {
      id: 'dual',
      label: '듀얼폰 3D 모드',
      badge: 'NEW',
      visible: true,
      onPress: () => router.push('/dual-phone'),
    },
    {
      id: 'screengolf',
      label: '스크린골프 연동 관리',
      badge: '연동됨',
      visible: isFeatureEnabled('SCREEN_GOLF_MENU'),
      onPress: () => Alert.alert('알림', '준비 중입니다'),
    },
    {
      id: 'notify',
      label: '알림 설정',
      badge: null,
      visible: true,
      onPress: () => Alert.alert('알림', '준비 중입니다'),
    },
    {
      id: 'support',
      label: '고객센터',
      badge: null,
      visible: true,
      onPress: () => Alert.alert('알림', '준비 중입니다'),
    },
  ];

  const visibleMenus = menuItems.filter((m) => m.visible);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topbar}>
        <Text style={styles.screenTitle}>마이</Text>
        <Text style={styles.screenSub}>내 정보와 서비스를 관리해요</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + BottomTabInset + 28,
        }}
      >
        <View style={styles.profileHead}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{initial}</Text>
          </View>
          <View>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileMeta}>{handicap} · SwingCare</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="신체 이력 프로필 수정"
          onPress={() => router.push('/profile-setup')}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>신체 · 이력 프로필</Text>
          <View style={styles.tags}>
            {ageLabel ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{ageLabel}</Text>
              </View>
            ) : null}
            {injuryLabels.map((label) => (
              <View key={label} style={styles.tag}>
                <Text style={styles.tagText}>{label}</Text>
              </View>
            ))}
            {!ageLabel && injuryLabels.length === 0 ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>프로필 입력</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.cardHint}>탭하여 수정 →</Text>
        </Pressable>

        <View style={styles.subCard}>
          <Text style={styles.subBadge}>
            {sub.isPremium ? '프리미엄 이용 중' : '무료 플랜 이용 중'}
            {sub.revenuecatLinked ? ' · RC 연동' : ''}
          </Text>
          {sub.isPremium ? (
            <>
              <Text style={styles.subTitle}>프리미엄 혜택을 이용 중이에요</Text>
              <Text style={styles.subBullet}>✓  스윙 밸런스 지수 상세 분석</Text>
              <Text style={styles.subBullet}>✓  Live AR 스윙 가이드</Text>
              <Text style={styles.subBullet}>✓  무제한 리포트 저장</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/subscribe')}
                style={styles.subCta}
              >
                <Text style={styles.subCtaLabel}>플랜 관리</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.subTitle}>프리미엄으로 더 자세히 보기</Text>
              <Text style={styles.subBullet}>✓  스윙 밸런스 지수 상세 분석</Text>
              <Text style={styles.subBullet}>✓  Live AR 스윙 가이드</Text>
              <Text style={styles.subBullet}>✓  무제한 리포트 저장</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/subscribe')}
                style={[
                  styles.subCta,
                  !isFeatureEnabled('PREMIUM_CHECKOUT') && styles.subCtaSoon,
                ]}
              >
                <Text style={styles.subCtaLabel}>
                  {isFeatureEnabled('PREMIUM_CHECKOUT')
                    ? '프리미엄 시작하기 · ₩12,900/월'
                    : '프리미엄 출시 예정'}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {visibleMenus.map((item, index, arr) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={item.onPress}
            style={[
              styles.menuItem,
              index === arr.length - 1 && styles.menuItemLast,
            ]}
          >
            <View style={styles.menuIcon}>
              <Text style={styles.menuIconText}>·</Text>
            </View>
            <Text style={styles.menuLabel}>{item.label}</Text>
            {item.badge ? (
              <View
                style={[
                  styles.menuBadge,
                  item.badge === 'NEW' && styles.menuBadgeNew,
                ]}
              >
                <Text
                  style={[
                    styles.menuBadgeText,
                    item.badge === 'NEW' && styles.menuBadgeTextNew,
                  ]}
                >
                  {item.badge}
                </Text>
              </View>
            ) : null}
            <Text style={styles.menuChev}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' },
  topbar: { paddingHorizontal: 20, marginBottom: 8 },
  screenTitle: { fontSize: 26, fontWeight: '800', color: '#1A2333' },
  screenSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
    marginTop: 4,
  },
  profileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginBottom: 16,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8971EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  profileName: { fontSize: 16.5, fontWeight: '800', color: '#232630' },
  profileMeta: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7A8198',
    marginTop: 3,
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#232630',
    marginBottom: 9,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(47,107,255,0.1)',
  },
  tagText: { fontSize: 11, fontWeight: '700', color: '#2F6BFF' },
  cardHint: {
    marginTop: 8,
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7A8198',
  },
  subCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(243,217,138,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(243,217,138,0.4)',
  },
  subBadge: {
    alignSelf: 'flex-start',
    fontSize: 10.5,
    fontWeight: '800',
    color: '#C48A1A',
    backgroundColor: 'rgba(243,217,138,0.45)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  subTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#232630',
    marginTop: 9,
    marginBottom: 12,
  },
  subBullet: {
    fontSize: 12,
    fontWeight: '600',
    color: '#232630',
    marginBottom: 7,
  },
  subCta: {
    marginTop: 8,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F6BFF',
  },
  subCtaSoon: {
    backgroundColor: '#A7ADBD',
  },
  subCtaLabel: { fontSize: 13, fontWeight: '800', color: '#fff' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(30,40,70,0.1)',
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(122,129,152,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconText: { fontSize: 18, fontWeight: '800', color: '#5A6478' },
  menuLabel: { flex: 1, fontSize: 13.5, fontWeight: '700', color: '#232630' },
  menuBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(45,184,138,0.15)',
  },
  menuBadgeNew: { backgroundColor: 'rgba(255,117,140,0.15)' },
  menuBadgeText: { fontSize: 10, fontWeight: '800', color: '#2DB88A' },
  menuBadgeTextNew: { color: '#FF758C' },
  menuChev: { fontSize: 17, color: '#9AA1B5' },
});
