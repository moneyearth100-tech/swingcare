import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACTIVE = '#232630';
const INACTIVE = '#A7ADBD';

const TAB_META: Record<
  string,
  {
    label: string;
    symbol: {
      ios: 'house' | 'camera' | 'chart.bar' | 'trophy' | 'person';
      android: 'home' | 'photo_camera' | 'bar_chart' | 'emoji_events' | 'person';
      web: 'home' | 'photo_camera' | 'bar_chart' | 'emoji_events' | 'person';
    };
  }
> = {
  index: {
    label: '홈',
    symbol: { ios: 'house', android: 'home', web: 'home' },
  },
  capture: {
    label: '촬영',
    symbol: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
  },
  explore: {
    label: '리포트',
    symbol: { ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' },
  },
  challenge: {
    label: '챌린지',
    symbol: { ios: 'trophy', android: 'emoji_events', web: 'emoji_events' },
  },
  my: {
    label: '마이',
    symbol: { ios: 'person', android: 'person', web: 'person' },
  },
};

type FloatingTabBarProps = {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
      };
    }
  >;
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented?: boolean };
    navigate: (name: string) => void;
  };
};

function canUseGlass() {
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

function resolveTabLabel(
  routeName: string,
  routeKey: string,
  descriptors: FloatingTabBarProps['descriptors'],
): string {
  const optionTitle = descriptors[routeKey]?.options?.title;
  if (typeof optionTitle === 'string' && optionTitle.length > 0) {
    return optionTitle;
  }
  return TAB_META[routeName]?.label ?? routeName;
}

export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const useGlass = canUseGlass();
  const bottom = Math.max(insets.bottom, 12) + 8;

  const content = (
    <>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const color = focused ? ACTIVE : INACTIVE;
        const meta = TAB_META[route.name] ?? {
          label: route.name,
          symbol: {
            ios: 'house' as const,
            android: 'home' as const,
            web: 'home' as const,
          },
        };
        const label = resolveTabLabel(route.name, route.key, descriptors);

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={onPress}
            style={styles.item}
          >
            <SymbolView
              name={meta.symbol}
              size={21}
              tintColor={color}
              weight="medium"
              fallback={
                <Text style={[styles.fallbackIcon, { color }]}>
                  {label.slice(0, 1)}
                </Text>
              }
            />
            <Text style={[styles.label, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </>
  );

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <View style={[styles.nav, !useGlass && styles.navFallback]}>
        {useGlass ? (
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            tintColor="rgba(255,255,255,0.55)"
            isInteractive
          />
        ) : null}
        {content}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 18,
    right: 18,
    zIndex: 60,
  },
  nav: {
    height: 68,
    borderRadius: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  navFallback: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: 'rgba(31,38,135,1)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
  },
  fallbackIcon: {
    fontSize: 14,
    fontWeight: '700',
  },
});
