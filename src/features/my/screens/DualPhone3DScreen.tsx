/**
 * 듀얼폰 3D 모드 — 1단계: 화면 진입·가이드만.
 * 세션 코드 페어링·동기 촬영은 이후 스프린트.
 */

import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DualPhone3DScreen() {
  const insets = useSafeAreaInsets();

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
        <Text style={styles.title}>듀얼폰 3D</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.body}>
        <Text style={styles.badge}>BETA</Text>
        <Text style={styles.lead}>
          폰 2대로 정면·측면을 함께 기록하는 모드예요.
        </Text>
        <Text style={styles.meta}>
          지금은 안내 화면까지 연결돼 있어요. 세션 코드로 페어링하고 동기
          촬영하는 기능은 다음 단계에서 붙일 예정이에요.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>준비되면 이렇게 진행해요</Text>
          <Text style={styles.step}>1. 메인 폰에서 세션 코드 생성</Text>
          <Text style={styles.step}>2. 보조 폰에서 코드 입력·페어링</Text>
          <Text style={styles.step}>3. 정면·측면 동시 녹화 후 비교</Text>
        </View>
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
    marginBottom: 12,
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
  body: { paddingHorizontal: 20 },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '800',
    color: '#FF758C',
    backgroundColor: 'rgba(255,117,140,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 12,
  },
  lead: {
    fontSize: 18,
    fontWeight: '800',
    color: '#232630',
    lineHeight: 26,
    marginBottom: 10,
  },
  meta: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
    lineHeight: 20,
    marginBottom: 20,
  },
  card: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30,40,70,0.08)',
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#232630',
    marginBottom: 4,
  },
  step: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5065',
    lineHeight: 20,
  },
});
