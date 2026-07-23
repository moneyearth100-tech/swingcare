/**
 * 촬영/업로드 진입 전 라벨링 동의 확인.
 * 온보딩에서 이미 동의했다면 패스.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/hooks/useAuth';
import { saveLabelingDataConsent } from '../../auth/lib/userProfile';
import { ensureAnonymousUser } from '../../../services/supabase/client';

type Props = {
  children: ReactNode;
};

export default function CaptureConsentGate({ children }: Props) {
  const insets = useSafeAreaInsets();
  const { profile, refresh, isLoading } = useAuth();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasConsent = profile?.labeling_data_consent_at != null;

  useEffect(() => {
    if (hasConsent) {
      setChecked(true);
    }
  }, [hasConsent]);

  const onConfirm = useCallback(async () => {
    if (!checked) {
      Alert.alert('동의 필요', '영상 활용 목적에 동의해 주세요.');
      return;
    }
    setSaving(true);
    try {
      // 항상 서버 검증된 세션을 확보한 뒤 저장 (stale user.id → RLS 방지)
      const anon = await ensureAnonymousUser();
      if (!anon.userId) {
        throw new Error(
          anon.errorMessage ??
            '로그인을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
      }
      await saveLabelingDataConsent(anon.userId);
      // session state 동기화까지 포함
      await refresh();
    } catch (e) {
      Alert.alert(
        '저장 실패',
        e instanceof Error ? e.message : '동의를 저장하지 못했어요.',
      );
    } finally {
      setSaving(false);
    }
  }, [checked, refresh]);

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color="#8971EA" />
      </View>
    );
  }

  if (hasConsent) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>촬영·업로드 전 동의가 필요해요</Text>
      <Text style={styles.body}>
        스윙 영상을 서버에 저장하고 라벨링·모델 개선에 활용하며, 필요 시
        제3자(라벨링 위탁업체 등)에 제공될 수 있습니다. 자세한 내용은
        개인정보 처리방침을 확인해 주세요.
      </Text>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => setChecked((v) => !v)}
        style={styles.row}
      >
        <View style={[styles.checkbox, checked && styles.checkboxOn]}>
          {checked ? <Text style={styles.mark}>✓</Text> : null}
        </View>
        <Text style={styles.consent}>
          (필수) 위 목적의 촬영 영상 활용에 동의합니다.
        </Text>
      </Pressable>

      <Pressable onPress={() => router.push('/privacy')}>
        <Text style={styles.link}>개인정보 처리방침 보기</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={saving || !checked}
        onPress={() => {
          void onConfirm();
        }}
        style={[styles.btn, (!checked || saving) && styles.btnDisabled]}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>동의하고 계속</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDFDFD',
  },
  root: {
    flex: 1,
    backgroundColor: '#FDFDFD',
    paddingHorizontal: 24,
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#232630',
  },
  body: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#9AA1B5',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxOn: {
    backgroundColor: '#8971EA',
    borderColor: '#8971EA',
  },
  mark: { color: '#fff', fontWeight: '800', fontSize: 13 },
  consent: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5065',
    lineHeight: 20,
  },
  link: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2F6BFF',
    textDecorationLine: 'underline',
  },
  btn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#2D3142',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
    minWidth: 160,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
