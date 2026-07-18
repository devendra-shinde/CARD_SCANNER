import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Button, Input, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { ApiError } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

export default function Signup() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!name.trim()) return setErr("Enter your name");
    if (!email.trim()) return setErr("Enter your email");
    if (password.length < 6) return setErr("Password must be at least 6 characters");
    setErr(null);
    setLoading(true);
    try {
      await signup({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        organization: org.trim(),
        role: role.trim(),
      });
      router.push({ pathname: "/(auth)/verify-otp", params: { email: email.trim().toLowerCase() } });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} testID="signup-back-btn" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={typography.h1}>Create your account</Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl }]}>
            Start scanning cards in under 30 seconds.
          </Text>

          <Input label="Full name" placeholder="Jane Cooper" value={name} onChangeText={setName} testID="signup-name-input" />
          <Input
            label="Work email"
            placeholder="you@company.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            testID="signup-email-input"
          />
          <Input
            label="Password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            testID="signup-password-input"
            right={
              <TouchableOpacity onPress={() => setShow((s) => !s)} testID="signup-toggle-password-visibility">
                <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            }
          />
          <Input label="Organization (optional)" placeholder="Acme Corp" value={org} onChangeText={setOrg} testID="signup-org-input" />
          <Input label="Role (optional)" placeholder="e.g. Sales Manager" value={role} onChangeText={setRole} testID="signup-role-input" />

          {err ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }} testID="signup-error">{err}</Text> : null}

          <Button title="Send verification code" onPress={onSubmit} loading={loading} testID="signup-submit-btn" />
          <View style={{ height: spacing.md }} />
          <View style={styles.row}>
            <Text style={{ color: colors.textSecondary }}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.replace("/(auth)/login")} testID="signup-goto-login-btn">
              <Text style={{ color: colors.accent, fontWeight: "700", marginLeft: 6 }}>Sign in</Text>
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
