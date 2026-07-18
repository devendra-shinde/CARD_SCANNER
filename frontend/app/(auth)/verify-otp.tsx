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
  const params = useLocalSearchParams<{ email: string; dev_otp?: string }>();
  const { verifyOtp, resendOtp } = useAuth();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string>((params.dev_otp as string) || "");
  const [resending, setResending] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);

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

  const autofillDev = () => {
    if (!devOtp || devOtp.length !== 6) return;
    setDigits(devOtp.split(""));
  };

  const onSubmit = async () => {
    const code = digits.join("");
    if (code.length !== 6) return setErr("Enter the 6-digit code");
    setErr(null);
    setLoading(true);
    try {
      await verifyOtp(String(params.email), code);
      router.replace("/(tabs)");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setResending(true);
    setErr(null);
    try {
      const { dev_otp } = await resendOtp(String(params.email));
      if (dev_otp) setDevOtp(dev_otp);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not resend");
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, padding: spacing.lg }}>
        <TouchableOpacity onPress={() => router.back()} testID="otp-back-btn" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.h1}>Enter verification code</Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg }]}>
          We sent a 6-digit code to <Text style={{ fontWeight: "700", color: colors.textPrimary }}>{params.email}</Text>.
        </Text>

        {devOtp ? (
          <View style={styles.devBanner} testID="otp-dev-banner">
            <View style={styles.devBadge}>
              <Ionicons name="construct-outline" size={14} color="#92400E" />
              <Text style={styles.devBadgeText}>PREVIEW MODE</Text>
            </View>
            <Text style={styles.devTitle}>Email delivery isn&apos;t configured yet</Text>
            <Text style={styles.devSub}>
              No SMTP server is set for this environment, so we haven&apos;t emailed you.
              Use this code to continue:
            </Text>
            <TouchableOpacity onPress={autofillDev} style={styles.devCodeBox} testID="otp-dev-autofill-btn" activeOpacity={0.85}>
              <Text style={styles.devCode}>{devOtp}</Text>
              <Text style={styles.devTap}>Tap to autofill</Text>
            </TouchableOpacity>
            <Text style={styles.devFooter}>
              To send real emails in production, set SYSTEM_SMTP_HOST/PORT/USER/PASS in the backend .env file.
            </Text>
          </View>
        ) : null}

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
        <TouchableOpacity onPress={onResend} disabled={resending} style={{ marginTop: spacing.lg, alignSelf: "center" }} testID="otp-resend-btn">
          <Text style={{ color: colors.accent, fontWeight: "600" }}>
            {resending ? "Sending…" : "Resend code"}
          </Text>
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
  devBanner: {
    backgroundColor: "#FEF3C7",
    borderWidth: 1, borderColor: "#FDE68A",
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  devBadge: {
    flexDirection: "row", alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FCD34D",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  devBadgeText: { color: "#92400E", fontWeight: "700", fontSize: 10, marginLeft: 4, letterSpacing: 0.5 },
  devTitle: { fontSize: 14, fontWeight: "700", color: "#92400E" },
  devSub: { fontSize: 13, color: "#92400E", marginTop: 4, lineHeight: 18 },
  devCodeBox: {
    marginTop: spacing.sm,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1, borderColor: "#FDE68A",
  },
  devCode: {
    fontSize: 30, fontWeight: "700", letterSpacing: 8, color: "#0F172A",
  },
  devTap: { fontSize: 11, color: "#92400E", marginTop: 2, fontWeight: "600" },
  devFooter: { fontSize: 11, color: "#92400E", marginTop: spacing.sm, opacity: 0.85, lineHeight: 16 },
});
