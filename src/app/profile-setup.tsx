/** 신체·이력 프로필 재편집 (마이/홈에서 진입) */

import { router } from 'expo-router';

import ProfileSetupScreen from '@/features/auth/screens/ProfileSetupScreen';

export default function ProfileSetupRoute() {
  return (
    <ProfileSetupScreen
      mode="edit"
      onClose={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
      }}
    />
  );
}
