import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 58 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 7,
          paddingBottom: bottomPadding,
          height: tabBarHeight + 4,
          backgroundColor: "#061426",
          borderTopColor: "#233B59",
          borderTopWidth: 1,
        },
        tabBarItemStyle: { minHeight: 48 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "800" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Главная",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: "Кейсы",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="doc.text.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="methodology"
        options={{ href: null, title: "Методика" }}
      />
      <Tabs.Screen
        name="usage"
        options={{
          title: "Аналитика",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="chart.bar.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="pumps"
        options={{ href: null, title: "Насосы" }}
      />
      <Tabs.Screen name="workspace" options={{ href: null, title: "Рабочая область" }} />
      <Tabs.Screen
        name="knowledge"
        options={{ href: null, title: "Знания" }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Профиль",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.crop.circle.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
