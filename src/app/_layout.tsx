import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/features/auth/hooks/useAuth';
import OnboardingLoginScreen from '@/features/auth/screens/OnboardingLoginScreen';
import ProfileSetupScreen from '@/features/auth/screens/ProfileSetupScreen';

SplashScreen.preventAutoHideAsync();

/**
 * 미로그인·프로필 미완료 시 (tabs)/capture(MediaPipe)를 마운트하지 않음.
 */
function AuthRoot() {
  const {
    isLoading,
    isSocialUser,
    isProfileComplete,
  } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isSocialUser) {
    return <OnboardingLoginScreen />;
  }

  if (!isProfileComplete) {
    return <ProfileSetupScreen mode="onboarding" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="profile-setup" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="report/[sessionId]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen
        name="review/[sessionId]"
        options={{
          animation: 'slide_from_bottom',
          // iOS 기본 엣지/풀스크린 스와이프 뒤로가기 비활성 — 닫기 버튼만 사용
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
        }}
      />
      <Stack.Screen name="subscribe" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="dual-phone" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="privacy" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="coaching/preview/[requestId]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="coaching/select-coach" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="coaching/requests" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AuthRoot />
      </ThemeProvider>
    </AuthProvider>
  );
}
