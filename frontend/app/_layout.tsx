import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/src/context/auth";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { consumePendingWebSession } from "@/src/lib/google-auth";
import { I18nProvider, useI18n } from "@/src/i18n";

LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

function RouterGate() {
  const { user, loading, refresh } = useAuth();
  const { onboarded, ready: i18nReady } = useI18n();
  const segments = useSegments();
  const router = useRouter();

  // On web, if we came back from Emergent auth with a session_id in the URL,
  // consume it once, save the JWT, then reload the auth state.
  useEffect(() => {
    (async () => {
      const consumed = await consumePendingWebSession();
      if (consumed) await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (loading || !i18nReady) return;
    const first = segments[0];
    const inAuthGroup = first === "(auth)";
    const inTabsGroup = first === "(tabs)";
    const onLangScreen = segments.join("/").includes("settings/language");

    // First-run: force language picker before anything else.
    if (!onboarded && !onLangScreen) {
      router.replace("/settings/language");
      return;
    }

    if (onboarded) {
      if (!user && !inAuthGroup && !onLangScreen) {
        router.replace("/(auth)/welcome");
      } else if (user && (inAuthGroup || segments.length === 0)) {
        router.replace("/(tabs)");
      } else if (user && !inTabsGroup && segments.length === 0) {
        router.replace("/(tabs)");
      }
    }
  }, [user, loading, segments, router, onboarded, i18nReady]);

  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <RouterGate />
          </AuthProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
