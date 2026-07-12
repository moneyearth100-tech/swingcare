/**
 * Phase 1 온보딩 — 소셜 로그인 (완료 후 신체·이력 프로필로 이어짐).
 * 라벨링·모델 개선용 영상 활용은 별도 체크박스로 동의받는다.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../hooks/useAuth';
import {
  signInWithSocialProvider,
  type SocialProviderId,
} from '../lib/socialAuth';
import { isDevAuthBypassEnabled } from '../lib/devAuthBypass';
import { saveLabelingDataConsent } from '../lib/userProfile';
import PrivacyPolicyBody from '../../legal/components/PrivacyPolicyBody';
import {
  ensureAnonymousUserId,
  getSupabaseClient,
} from '../../../services/supabase/client';

const PROVIDERS: {
  id: SocialProviderId;
  label: string;
  backgroundColor: string;
  textColor: string;
}[] = [
  {
    id: 'apple',
    label: 'Apple로 계속하기',
    backgroundColor: '#111111',
    textColor: '#FFFFFF',
  },
  {
    id: 'google',
    label: 'Google로 계속하기',
    backgroundColor: '#FFFFFF',
    textColor: '#1F1F1F',
  },
  {
    id: 'kakao',
    label: '카카오로 계속하기',
    backgroundColor: '#FEE500',
    textColor: '#191919',
  },
  {
    id: 'naver',
    label: '네이버로 계속하기',
    backgroundColor: '#03C75A',
    textColor: '#FFFFFF',
  },
];

export default function OnboardingLoginScreen() {
  const insets = useSafeAreaInsets();
  const { isConfigured, refresh, skipSocialLoginForDev } = useAuth();
  const devTempLoginEnabled = isDevAuthBypassEnabled();
  const [busyProvider, setBusyProvider] = useState<SocialProviderId | null>(
    null,
  );
  const [devSkipping, setDevSkipping] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeLabeling, setAgreeLabeling] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const persistLabelingConsentIfNeeded = useCallback(async () => {
    if (!agreeLabeling) {
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? (await ensureAnonymousUserId());
    if (!userId) {
      return;
    }
    await saveLabelingDataConsent(userId);
  }, [agreeLabeling]);

  const handlePress = useCallback(
    async (provider: SocialProviderId) => {
      if (busyProvider || devSkipping) {
        return;
      }
      if (!agreeTerms) {
        Alert.alert(
          '동의 필요',
          '서비스 이용약관 및 개인정보 처리방침에 동의해 주세요.',
        );
        return;
      }
      if (!agreeLabeling) {
        Alert.alert(
          '동의 필요',
          '촬영 영상 서버 저장·라벨링·모델 개선 목적 활용(필요 시 제3자 제공 포함)에 동의해 주세요.',
        );
        return;
      }
      if (!isConfigured) {
        Alert.alert(
          '설정 필요',
          'Supabase 환경 변수가 없습니다. .env의 EXPO_PUBLIC_SUPABASE_URL / ANON_KEY를 확인해주세요.',
        );
        return;
      }

      setBusyProvider(provider);
      try {
        await signInWithSocialProvider(provider);
        await persistLabelingConsentIfNeeded();
        await refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '로그인에 실패했습니다.';
        Alert.alert('로그인', message);
      } finally {
        setBusyProvider(null);
      }
    },
    [
      agreeLabeling,
      agreeTerms,
      busyProvider,
      devSkipping,
      isConfigured,
      persistLabelingConsentIfNeeded,
      refresh,
    ],
  );

  const handleDevSkip = useCallback(async () => {
    if (busyProvider || devSkipping) {
      return;
    }
    if (!agreeTerms || !agreeLabeling) {
      Alert.alert(
        '동의 필요',
        '개발용 스킵 전에도 필수 동의 항목을 체크해 주세요.',
      );
      return;
    }
    if (!isConfigured) {
      Alert.alert(
        '설정 필요',
        'Supabase 환경 변수가 없습니다. .env의 EXPO_PUBLIC_SUPABASE_URL / ANON_KEY를 확인해주세요.',
      );
      return;
    }
    setDevSkipping(true);
    try {
      await skipSocialLoginForDev();
      await persistLabelingConsentIfNeeded();
      await refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '개발용 스킵에 실패했습니다.';
      Alert.alert('개발용 스킵', message);
    } finally {
      setDevSkipping(false);
    }
  }, [
    agreeLabeling,
    agreeTerms,
    busyProvider,
    devSkipping,
    isConfigured,
    persistLabelingConsentIfNeeded,
    refresh,
    skipSocialLoginForDev,
  ]);

  const canContinue = agreeTerms && agreeLabeling;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.hero}>
          <Text style={styles.brand}>SwingCare</Text>
          <Text style={styles.headline}>
            스윙을 더 편하게,{'\n'}이어서 관리하세요
          </Text>
          <Text style={styles.sub}>
            계정으로 시작하면 촬영 기록과 컨디셔닝 인사이트를 기기에 맞춰
            안전하게 동기화할 수 있어요.
          </Text>
        </View>

        <View style={styles.consentBox}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreeTerms }}
            onPress={() => setAgreeTerms((v) => !v)}
            style={styles.consentRow}
          >
            <View
              style={[styles.checkbox, agreeTerms && styles.checkboxOn]}
            >
              {agreeTerms ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              (필수) 서비스 이용약관 및{' '}
              <Text
                style={styles.link}
                onPress={() => setPrivacyOpen(true)}
              >
                개인정보 처리방침
              </Text>
              에 동의합니다.
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreeLabeling }}
            onPress={() => setAgreeLabeling((v) => !v)}
            style={styles.consentRow}
          >
            <View
              style={[styles.checkbox, agreeLabeling && styles.checkboxOn]}
            >
              {agreeLabeling ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              (필수) 촬영 영상을 서버에 저장하고, 라벨링·모델 개선 목적으로
              활용하며, 필요 시 제3자(라벨링 작업 위탁업체 등)에 제공될 수
              있음에 동의합니다.
            </Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          {PROVIDERS.map((item) => {
            const busy = busyProvider === item.id;
            const disabled =
              busyProvider != null || devSkipping || !canContinue;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                disabled={disabled}
                onPress={() => {
                  void handlePress(item.id);
                }}
                style={[
                  styles.button,
                  {
                    backgroundColor: item.backgroundColor,
                    opacity: disabled && !busy ? 0.45 : 1,
                    borderWidth: item.id === 'google' ? 1 : 0,
                    borderColor: 'rgba(0,0,0,0.08)',
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={item.textColor} />
                ) : (
                  <Text style={[styles.buttonLabel, { color: item.textColor }]}>
                    {item.label}
                  </Text>
                )}
              </Pressable>
            );
          })}

          {devTempLoginEnabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="개발 임시 로그인"
              disabled={busyProvider != null || devSkipping || !canContinue}
              onPress={() => {
                void handleDevSkip();
              }}
              style={[
                styles.button,
                styles.devSkipButton,
                (busyProvider != null ||
                  devSkipping ||
                  !canContinue) && { opacity: 0.45 },
              ]}
            >
              {devSkipping ? (
                <ActivityIndicator color="#5A6478" />
              ) : (
                <Text style={styles.devSkipLabel}>개발임시로그인</Text>
              )}
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.footnote}>
          {Platform.OS === 'ios'
            ? 'Apple 로그인은 기기 Face ID / Touch ID 설정을 따릅니다.'
            : 'Google·카카오 로그인은 브라우저 인증 후 앱으로 돌아옵니다.'}
        </Text>
      </ScrollView>

      <Modal
        visible={privacyOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPrivacyOpen(false)}
      >
        <View style={[styles.privacyModal, { paddingTop: insets.top + 8 }]}>
          <View style={styles.privacyHead}>
            <Text style={styles.privacyTitle}>개인정보 처리방침</Text>
            <Pressable onPress={() => setPrivacyOpen(false)}>
              <Text style={styles.privacyClose}>닫기</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <PrivacyPolicyBody />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F7FB',
    paddingHorizontal: 24,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  hero: {
    gap: 12,
    marginTop: 12,
    marginBottom: 20,
  },
  brand: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A2333',
    letterSpacing: -0.5,
  },
  headline: {
    fontSize: 26,
    fontWeight: '800',
    color: '#232630',
    lineHeight: 34,
  },
  sub: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 22,
    marginTop: 4,
  },
  consentBox: {
    gap: 14,
    marginBottom: 20,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.1)',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#9AA1B5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    backgroundColor: '#fff',
  },
  checkboxOn: {
    backgroundColor: '#8971EA',
    borderColor: '#8971EA',
  },
  checkMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  consentText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#4A5065',
    lineHeight: 19,
  },
  link: {
    color: '#2F6BFF',
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  actions: {
    gap: 12,
  },
  button: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  devSkipButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(90,100,120,0.35)',
    borderStyle: 'dashed',
  },
  devSkipLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5A6478',
  },
  footnote: {
    marginTop: 18,
    fontSize: 11,
    fontWeight: '600',
    color: '#9AA1B5',
    lineHeight: 17,
    textAlign: 'center',
  },
  privacyModal: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  privacyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  privacyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A2333',
  },
  privacyClose: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2F6BFF',
  },
});
