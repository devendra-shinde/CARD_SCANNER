import { useRouter } from "expo-router";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { Button, Screen } from "@/src/components/ui";
import { GoogleAuthButton, OrDivider } from "@/src/components/google-auth-button";
import { useT } from "@/src/i18n";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function Welcome() {
  const router = useRouter();
  const t = useT();
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.hero}>
        <Image
          source={{ uri: "https://images.pexels.com/photos/5917718/pexels-photo-5917718.jpeg" }}
          style={styles.image}
          resizeMode="cover"
        />
        <LinearGradient
          colors={["transparent", "rgba(15,23,42,0.65)", "rgba(15,23,42,0.95)"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>{t("app_name").toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{t("welcome_hero")}</Text>
        <Text style={styles.subtitle}>{t("welcome_sub")}</Text>

        <View style={{ height: spacing.lg }} />
        <GoogleAuthButton testID="welcome-google-btn" />
        <OrDivider />
        <Button
          title={t("welcome_get_started")}
          onPress={() => router.push("/(auth)/signup")}
          testID="welcome-signup-btn"
        />
        <View style={{ height: spacing.sm }} />
        <Button
          title={t("welcome_have_account")}
          variant="ghost"
          onPress={() => router.push("/(auth)/login")}
          testID="welcome-login-btn"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, minHeight: 320, position: "relative", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.accent, marginRight: 6,
  },
  badgeText: { ...typography.caption, color: colors.textPrimary },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
  },
  title: {
    ...typography.h1,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
