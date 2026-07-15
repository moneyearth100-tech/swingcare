/**
 * 신체·이력 프로필 — 온보딩 마지막 단계 / 마이에서 재편집.
 * 목업 #detail-profile + 2장 규제 가드레일 카피.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../hooks/useAuth';
import {
  AGE_GROUP_OPTIONS,
  DOMINANT_HAND_OPTIONS,
  HANDICAP_DEFAULT,
  HANDICAP_MAX,
  HANDICAP_MIN,
  INJURY_HISTORY_OPTIONS,
  toggleInjurySelection,
  type AgeGroup,
  type DominantHand,
  type InjuryHistoryCode,
} from '../lib/profileTypes';
import { saveUserProfile } from '../lib/userProfile';

export type ProfileSetupMode = 'onboarding' | 'edit';

interface ProfileSetupScreenProps {
  mode?: ProfileSetupMode;
  onClose?: () => void;
  onSaved?: () => void;
}

export default function ProfileSetupScreen({
  mode = 'onboarding',
  onClose,
  onSaved,
}: ProfileSetupScreenProps) {
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(null);
  const [injuries, setInjuries] = useState<InjuryHistoryCode[]>([]);
  const [handicap, setHandicap] = useState(HANDICAP_DEFAULT);
  const [dominantHand, setDominantHand] = useState<DominantHand | null>(null);
  const [saving, setSaving] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    if (!profile) {
      return;
    }
    if (profile.age_group) {
      setAgeGroup(profile.age_group);
    }
    if (profile.injury_history.length > 0) {
      setInjuries(profile.injury_history);
    }
    if (profile.handicap != null && Number.isFinite(profile.handicap)) {
      setHandicap(profile.handicap);
    }
    if (profile.dominant_hand) {
      setDominantHand(profile.dominant_hand);
    }
  }, [profile]);

  const canSave = ageGroup != null && injuries.length > 0 && !saving;

  const fillRatio = useMemo(() => {
    const span = HANDICAP_MAX - HANDICAP_MIN;
    return span <= 0 ? 0 : (handicap - HANDICAP_MIN) / span;
  }, [handicap]);

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const setHandicapFromX = useCallback(
    (x: number) => {
      if (trackWidth <= 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(x, trackWidth));
      const ratio = clamped / trackWidth;
      const raw = HANDICAP_MIN + ratio * (HANDICAP_MAX - HANDICAP_MIN);
      setHandicap(Math.round(raw));
    },
    [trackWidth],
  );

  const handleSave = useCallback(async () => {
    if (!user?.id) {
      Alert.alert('저장', '로그인 세션이 없습니다. 다시 로그인해 주세요.');
      return;
    }
    if (!ageGroup) {
      Alert.alert('저장', '연령대를 선택해 주세요.');
      return;
    }
    if (injuries.length === 0) {
      Alert.alert('저장', '기존 통증·부상 이력을 하나 이상 선택해 주세요.');
      return;
    }

    setSaving(true);
    try {
      await saveUserProfile(user.id, {
        age_group: ageGroup,
        injury_history: injuries,
        handicap,
        dominant_hand: dominantHand,
      });
      await refreshProfile();
      Alert.alert('저장', '프로필이 저장됐어요');
      onSaved?.();
      if (mode === 'edit') {
        onClose?.();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '프로필 저장에 실패했습니다.';
      Alert.alert('저장', message);
    } finally {
      setSaving(false);
    }
  }, [
    ageGroup,
    dominantHand,
    handicap,
    injuries,
    mode,
    onClose,
    onSaved,
    refreshProfile,
    user?.id,
  ]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        {mode === 'edit' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            hitSlop={12}
            onPress={onClose}
            style={styles.backBtn}
          >
            <Text style={styles.backLabel}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <Text style={styles.title}>신체 · 이력 프로필</Text>
        <View style={styles.backSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'onboarding' ? (
          <Text style={styles.lead}>
            스윙 컨디셔닝을 맞추기 위한 기본 정보예요. 한 번만 입력하면 홈으로
            이어집니다.
          </Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>연령대</Text>
          <View style={styles.chips}>
            {AGE_GROUP_OPTIONS.map((opt) => {
              const active = ageGroup === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setAgeGroup(opt.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipLabel, active && styles.chipLabelActive]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>주손방향</Text>
          <Text style={styles.sectionHint}>
            우타·좌타를 고르면 체중 이동 방향·손목 코킹 표시를 맞춰 줘요.
            선택하지 않아도 저장할 수 있고, 나중에 촬영·영상 업로드에서도 바꿀 수
            있어요.
          </Text>
          <View style={styles.chips}>
            {DOMINANT_HAND_OPTIONS.map((opt) => {
              const active = dominantHand === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  accessibilityRole="button"
                  accessibilityLabel={`주손방향 ${opt.label}`}
                  accessibilityState={{ selected: active }}
                  onPress={() =>
                    setDominantHand((prev) =>
                      prev === opt.id ? null : opt.id,
                    )
                  }
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipLabel, active && styles.chipLabelActive]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>기존 통증 · 부상 이력</Text>
          <Text style={styles.sectionHint}>
            의료 진단이 아니라, 밸런스 지수·컨디셔닝 인사이트를 참고할 때 쓰는
            정보예요. 선택해도 위험군이나 질환으로 판정하지 않습니다.
          </Text>
          <View style={styles.chips}>
            {INJURY_HISTORY_OPTIONS.map((opt) => {
              const active = injuries.includes(opt.id);
              return (
                <Pressable
                  key={opt.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() =>
                    setInjuries((prev) => toggleInjurySelection(prev, opt.id))
                  }
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipLabel, active && styles.chipLabelActive]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>핸디캡</Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`핸디캡 ${handicap}`}
            onLayout={onTrackLayout}
            onPress={(event) => setHandicapFromX(event.nativeEvent.locationX)}
            style={styles.track}
          >
            <View
              style={[
                styles.trackFill,
                { width: `${Math.max(4, fillRatio * 100)}%` },
              ]}
            />
          </Pressable>
          <View style={styles.handicapRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setHandicap((v) => Math.max(HANDICAP_MIN, v - 1))
              }
              style={styles.stepBtn}
            >
              <Text style={styles.stepLabel}>−</Text>
            </Pressable>
            <Text style={styles.handicapMeta}>현재 {handicap}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setHandicap((v) => Math.min(HANDICAP_MAX, v + 1))
              }
              style={styles.stepBtn}
            >
              <Text style={styles.stepLabel}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.handicapRange}>
            {HANDICAP_MIN} ~ {HANDICAP_MAX}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!canSave}
          onPress={() => {
            void handleSave();
          }}
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveLabel}>저장</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontSize: 28,
    fontWeight: '500',
    color: '#232630',
    marginTop: -2,
  },
  backSpacer: {
    width: 36,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#1A2333',
  },
  scroll: {
    paddingHorizontal: 20,
    gap: 14,
  },
  lead: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 20,
    marginBottom: 4,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#232630',
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 18,
    marginTop: -4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(40,50,80,0.16)',
    backgroundColor: 'transparent',
  },
  chipActive: {
    borderColor: '#2F6BFF',
    backgroundColor: 'rgba(47,107,255,0.12)',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4A5168',
  },
  chipLabelActive: {
    color: '#1E4FD6',
  },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(40,50,80,0.1)',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2F6BFF',
  },
  handicapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  handicapMeta: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7A8198',
  },
  handicapRange: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9AA1B5',
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(47,107,255,0.1)',
  },
  stepLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2F6BFF',
  },
  saveBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2F6BFF',
    marginTop: 6,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
