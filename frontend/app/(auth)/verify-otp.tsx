import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { Button, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function VerifyOtp() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { verifyOtp, resendOtp } = useAuth();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef<Array<TextInput | null>>([]);

  const setDigit = (i: number, val: string) => {
    const v = val.replace(/[^0-9]/g, "").slice(0, 1);
    const arr = [...digits];
    arr[i] = v;
    setDigits(arr);
    if (v && i < 5) inputs.current[i + 1]?.focus();
  };

  const onBackspace = (i: number) => {
    if (!digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const onSubmit = async () => {
    const code = digits.join("");
    if (code.length !== 6) return setErr("Enter the 6-digit code");
    setErr(null);
    setLoading(true);
    try {
      await verifyOtp(String(email), code);
      router.replace("/(tabs)");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    try {
      await resendOtp(String(email));
    } catch {}
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, padding: spacing.lg }}>
        <TouchableOpacity onPress={() => router.back()} testID="otp-back-btn" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.h1}>Enter verification code</Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.xl }]}>
          We sent a 6-digit code to <Text style={{ fontWeight: "700", color: colors.textPrimary }}>{email}</Text>.
        </Text>

        <View style={styles.otpRow}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(r) => { inputs.current[i] = r; }}
              value={d}
              onChangeText={(v) => setDigit(i, v)}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === "Backspace") onBackspace(i);
              }}
              keyboardType="number-pad"
              maxLength={1}
              style={styles.otpBox}
              testID={`otp-input-${i}`}
              autoFocus={i === 0}
            />
          ))}
        </View>

        {err ? <Text style={{ color: colors.danger, marginTop: spacing.md }} testID="otp-error">{err}</Text> : null}

        <View style={{ marginTop: spacing.xl }}>
          <Button title="Verify email" onPress={onSubmit} loading={loading} testID="otp-verify-btn" />
        </View>
        <TouchableOpacity onPress={onResend} style={{ marginTop: spacing.lg, alignSelf: "center" }} testID="otp-resend-btn">
          <Text style={{ color: colors.accent, fontWeight: "600" }}>Resend code</Text>
        </TouchableOpacity>
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
  otpRow: { flexDirection: "row", justifyContent: "space-between" },
  otpBox: {
    width: 48, height: 56,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    textAlign: "center", fontSize: 22, fontWeight: "700",
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
});
