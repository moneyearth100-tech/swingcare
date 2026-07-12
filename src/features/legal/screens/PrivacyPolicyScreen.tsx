/**
 * 개인정보 처리방침 (인앱 열람용).
 */

import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PrivacyPolicyBody from '../components/PrivacyPolicyBody';

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>개인정보 처리방침</Text>
        <View style={styles.backSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <PrivacyPolicyBody />
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
  backSpacer: { width: 40 },
});
