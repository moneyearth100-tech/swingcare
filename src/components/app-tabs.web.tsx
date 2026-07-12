import { Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/floating-tab-bar';

export default function AppTabs() {
  return (
    <Tabs
      tabBar={(props) => (
        <FloatingTabBar
          state={props.state}
          descriptors={props.descriptors}
          navigation={props.navigation}
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: '홈' }} />
      <Tabs.Screen name="capture" options={{ title: '촬영' }} />
      <Tabs.Screen name="explore" options={{ title: '리포트' }} />
      <Tabs.Screen name="challenge" options={{ title: '챌린지' }} />
      <Tabs.Screen name="my" options={{ title: '마이' }} />
    </Tabs>
  );
}
