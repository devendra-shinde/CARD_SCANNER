/**
 * "Continue with Google" button — reusable across welcome + login + signup.
 */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAuth } from "@/src/context/auth";
import { useGoogleAuth } from "@/src/lib/google-auth";
import { colors, radius, spacing, typography } from "@/src/theme";

export function GoogleAuthButton({ onSuccess, testID }: { onSuccess?: () => void; testID?: string }) {
  const { signInWithGoogle, loading } = useGoogleAuth();
  const { refresh } = useAuth();

  const onPress = async () => {
    const res = await signInWithGoogle();
    if (res.ok) {
      await refresh();
      onSuccess?.();
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
      style={[styles.btn, loading && { opacity: 0.6 }]}
      testID={testID || "google-signin-btn"}
    >
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} />
      ) : (
        <>
          <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
          <Text style={styles.text}>Continue with Google</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function OrDivider() {
  return (
    <View style={styles.divider}>
      <View style={styles.line} />
      <Text style={styles.or}>or</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: spacing.lg,
  },
  text: { ...typography.bodyStrong, fontSize: 16 },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.md,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  or: {
    marginHorizontal: 12,
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: "600",
  },
});
