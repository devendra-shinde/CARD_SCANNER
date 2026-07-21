import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Button, Input, Screen } from "@/src/components/ui";
import { GoogleAuthButton, OrDivider } from "@/src/components/google-auth-button";
import { useAuth } from "@/src/context/auth";
import { ApiError } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setErr("Enter email and password");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/(tabs)");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Login failed";
      setErr(msg);
      if (e instanceof ApiError && e.status === 403) {
        // Backend may return either a plain string detail or an object with dev_otp.
        const detail = e.data?.detail;
        const devOtp = typeof detail === "object" ? detail?.dev_otp : undefined;
        router.push({
          pathname: "/(auth)/verify-otp",
          params: { email: email.trim().toLowerCase(), dev_otp: devOtp || "" },
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} testID="login-back-btn" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={typography.h1}>Welcome back</Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl }]}>
            Sign in to your CardVault workspace.
          </Text>

          <Input
            label="Email"
            placeholder="you@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            testID="login-email-input"
          />
          <Input
            label="Password"
            placeholder="••••••••"
            secureTextEntry={!show}
            value={password}
            onChangeText={setPassword}
            testID="login-password-input"
            right={
              <TouchableOpacity onPress={() => setShow((s) => !s)} testID="login-toggle-password-visibility">
                <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            }
          />

          <TouchableOpacity
            onPress={() => router.push("/(auth)/forgot-password")}
            style={{ alignSelf: "flex-end", marginBottom: spacing.md }}
            testID="login-forgot-password-btn"
          >
            <Text style={{ color: colors.accent, fontWeight: "600" }}>Forgot password?</Text>
          </TouchableOpacity>

          {err ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }} testID="login-error">{err}</Text> : null}

          <Button title="Sign in" onPress={onSubmit} loading={loading} testID="login-submit-btn" />
          <OrDivider />
          <GoogleAuthButton testID="login-google-btn" onSuccess={() => router.replace("/(tabs)")} />
          <View style={{ height: spacing.md }} />
          <View style={styles.row}>
            <Text style={{ color: colors.textSecondary }}>Don&apos;t have an account?</Text>
            <TouchableOpacity onPress={() => router.replace("/(auth)/signup")} testID="login-goto-signup-btn">
              <Text style={{ color: colors.accent, fontWeight: "700", marginLeft: 6 }}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, flexGrow: 1 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg,
  },
  row: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
});
