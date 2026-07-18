import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Button, Input, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { ApiError } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

export default function ForgotPassword() {
  const router = useRouter();
  const { forgotPassword, resetPassword, login } = useAuth();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPw, setNewPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const requestCode = async () => {
    if (!email.trim()) return setErr("Enter your email");
    setLoading(true); setErr(null);
    try {
      const { dev_otp } = await forgotPassword(email.trim().toLowerCase());
      if (dev_otp) {
        setMsg(`Preview mode — reset code: ${dev_otp}`);
        setOtp(dev_otp);
      } else {
        setMsg("If the email exists, a reset code has been sent.");
      }
      setStep("reset");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Request failed");
    } finally { setLoading(false); }
  };

  const applyReset = async () => {
    if (otp.length !== 6) return setErr("Enter the 6-digit code");
    if (newPw.length < 6) return setErr("Password must be at least 6 characters");
    setLoading(true); setErr(null);
    try {
      await resetPassword(email.trim().toLowerCase(), otp, newPw);
      await login(email.trim().toLowerCase(), newPw);
      router.replace("/(tabs)");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Reset failed");
    } finally { setLoading(false); }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} testID="forgot-back-btn" style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={typography.h1}>Reset your password</Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl }]}>
            {step === "email" ? "Enter your email and we’ll send a 6-digit reset code." : "Enter the code and choose a new password."}
          </Text>

          {step === "email" ? (
            <>
              <Input
                label="Email"
                placeholder="you@company.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="forgot-email-input"
              />
              {err ? <Text style={{ color: colors.danger }} testID="forgot-error">{err}</Text> : null}
              <View style={{ height: spacing.md }} />
              <Button title="Send reset code" onPress={requestCode} loading={loading} testID="forgot-send-btn" />
            </>
          ) : (
            <>
              <Input label="6-digit code" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} testID="forgot-otp-input" />
              <Input label="New password" value={newPw} onChangeText={setNewPw} secureTextEntry testID="forgot-newpw-input" />
              {msg ? <Text style={{ color: colors.textSecondary, marginBottom: spacing.sm }}>{msg}</Text> : null}
              {err ? <Text style={{ color: colors.danger }} testID="forgot-error">{err}</Text> : null}
              <View style={{ height: spacing.md }} />
              <Button title="Reset & sign in" onPress={applyReset} loading={loading} testID="forgot-reset-btn" />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.lg,
  },
});
