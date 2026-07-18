import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Input } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api, ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

const PROVIDER_DEFAULTS: Record<string, { host: string; port: number }> = {
  gmail: { host: "smtp.gmail.com", port: 587 },
  outlook: { host: "smtp-mail.outlook.com", port: 587 },
  yahoo: { host: "smtp.mail.yahoo.com", port: 587 },
  custom: { host: "", port: 587 },
};

export default function EmailSettings() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<any>({
    provider: "custom",
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    from_name: "",
    reply_to: "",
    use_tls: true,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api<any>("/settings/email");
        if (cfg && cfg.smtp_host) setValues((v: any) => ({ ...v, ...cfg }));
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
  }, [user, testTo]);

  const setProvider = (p: string) => {
    const d = PROVIDER_DEFAULTS[p];
    setValues((v: any) => ({ ...v, provider: p, smtp_host: d.host || v.smtp_host, smtp_port: d.port }));
  };
  const set = (k: string, v: any) => setValues((prev: any) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null);
    try {
      await api("/settings/email", { method: "POST", body: { ...values, smtp_port: Number(values.smtp_port) } });
      setMsg("SMTP config saved.");
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const test = async () => {
    if (!testTo) { setErr("Enter a test recipient email."); return; }
    setTesting(true); setMsg(null); setErr(null);
    try {
      await save();
      await api("/settings/email/test", { method: "POST", body: { to: testTo } });
      setMsg("Test email sent successfully.");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Test failed";
      setErr(message);
    } finally { setTesting(false); }
  };

  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="email-settings-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="email-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Email sending</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={typography.h3}>Choose provider</Text>
          <Text style={[typography.small, { marginBottom: spacing.md }]}>Emails are sent from your own SMTP so replies come to you.</Text>
          <View style={styles.providerRow}>
            {(["gmail", "outlook", "yahoo", "custom"] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setProvider(p)}
                style={[styles.providerCard, values.provider === p && { borderColor: colors.brand, backgroundColor: colors.surface }]}
                testID={`email-provider-${p}`}
              >
                <Ionicons
                  name={p === "gmail" ? "logo-google" : p === "outlook" ? "mail" : p === "yahoo" ? "at" : "server"}
                  size={20}
                  color={values.provider === p ? colors.brand : colors.textSecondary}
                />
                <Text style={[styles.providerLabel, values.provider === p && { color: colors.brand }]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[typography.caption, { marginTop: spacing.md, marginBottom: spacing.xs }]}>
            {values.provider === "gmail" ? "USE AN APP PASSWORD (2FA required)" : "SMTP DETAILS"}
          </Text>

          <Input label="SMTP host" value={values.smtp_host} onChangeText={(v) => set("smtp_host", v)} placeholder="smtp.example.com" autoCapitalize="none" testID="email-host-input" />
          <Input label="Port" value={String(values.smtp_port)} onChangeText={(v) => set("smtp_port", v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="email-port-input" />
          <Input label="Username / Email" value={values.smtp_user} onChangeText={(v) => set("smtp_user", v)} placeholder="you@example.com" autoCapitalize="none" testID="email-user-input" />
          <Input label="Password / App password" value={values.smtp_pass} onChangeText={(v) => set("smtp_pass", v)} secureTextEntry testID="email-pass-input" />
          <Input label="From name" value={values.from_name} onChangeText={(v) => set("from_name", v)} placeholder="Your Name <you@example.com>" testID="email-from-input" />
          <Input label="Reply-to (optional)" value={values.reply_to} onChangeText={(v) => set("reply_to", v)} autoCapitalize="none" testID="email-replyto-input" />

          <View style={{ height: spacing.sm }} />
          <Text style={[typography.caption, { marginBottom: spacing.xs }]}>TEST</Text>
          <Input label="Send test to" value={testTo} onChangeText={setTestTo} autoCapitalize="none" keyboardType="email-address" testID="email-testto-input" />

          {msg ? <Text style={{ color: colors.accent, marginBottom: spacing.sm }} testID="email-msg">{msg}</Text> : null}
          {err ? <Text style={{ color: colors.danger, marginBottom: spacing.sm }} testID="email-err">{err}</Text> : null}

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Save" variant="secondary" onPress={save} loading={saving} testID="email-save-btn" />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Save & test" onPress={test} loading={testing} icon="send" testID="email-test-btn" />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  providerRow: { flexDirection: "row", gap: 8 },
  providerCard: {
    flex: 1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  providerLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginTop: 4 },
});
