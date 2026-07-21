import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type BillingStatus = {
  plan: string;
  plan_details: { name: string; price_monthly: number; price_yearly: number };
  daily_sent: number; daily_cap: number | null; remaining_today: number | null;
  subscription_current_period_end: string | null;
  razorpay_configured: boolean;
};

const PLAN_FEATURES: Record<string, { basic: string[]; pro: string[] }> = {
  basic: {
    basic: [
      "Email campaigns", "AI Email Assistant", "Email templates", "Attachments",
      "Excel import & export", "Unlimited daily recipients", "3 emails / recipient / 7 days",
    ],
    pro: [],
  },
  pro: {
    basic: ["Everything in Basic"],
    pro: [
      "WhatsApp campaigns", "WhatsApp templates", "Personalized bulk WhatsApp launch",
      "Priority AI limits", "Future premium features",
    ],
  },
};

export default function PlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<BillingStatus>("/billing/status");
        setStatus(s);
      } catch {}
    })();
  }, []);

  const startCheckout = async (plan: "basic" | "pro") => {
    setBusy(plan);
    try {
      const order = await api<{ order_id: string; amount: number; currency: string; key_id: string }>("/billing/checkout", {
        method: "POST",
        body: { plan, cycle },
      });
      // On mobile app we'd open a Razorpay checkout screen here. In preview,
      // we surface the order details so testers can complete via a paired flow.
      Alert.alert(
        "Payment ready",
        `Order created (id: ${order.order_id}, ₹${order.amount / 100}). Open Razorpay in the mobile SDK to complete payment.`,
        [
          { text: "OK" },
        ]
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        Alert.alert(
          "Razorpay not configured",
          "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env to enable checkout."
        );
      } else {
        Alert.alert("Checkout failed", (e as any)?.message || "Try again");
      }
    } finally { setBusy(null); }
  };

  const cancel = async () => {
    Alert.alert("Cancel subscription?", "You'll revert to Free at the end of the current period.", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, cancel", style: "destructive", onPress: async () => {
          try { await api("/billing/cancel", { method: "POST" }); router.replace("/(tabs)/settings"); }
          catch {}
        },
      },
    ]);
  };

  if (!status) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="plans-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="plans-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Plans & billing</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Card style={{ backgroundColor: colors.brand, borderColor: colors.brand }} testID="plans-current-card">
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>CURRENT PLAN</Text>
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "700", marginTop: 4 }}>{status.plan_details.name}</Text>
          {status.plan === "free" ? (
            <Text style={{ color: "rgba(255,255,255,0.8)", marginTop: 4 }}>
              Daily quota: {status.daily_sent} / {status.daily_cap} recipients sent today
            </Text>
          ) : (
            <Text style={{ color: "rgba(255,255,255,0.8)", marginTop: 4 }}>Unlimited daily recipients · 3 emails / recipient / 7 days</Text>
          )}
          {status.plan !== "free" ? (
            <TouchableOpacity onPress={cancel} style={styles.cancelBtn} testID="plans-cancel-btn">
              <Text style={{ color: "#fff", fontWeight: "700" }}>Cancel subscription</Text>
            </TouchableOpacity>
          ) : null}
        </Card>

        <View style={styles.toggle} testID="plans-cycle-toggle">
          <TouchableOpacity onPress={() => setCycle("monthly")} style={[styles.toggleBtn, cycle === "monthly" && styles.toggleBtnActive]} testID="plans-cycle-monthly">
            <Text style={[styles.toggleText, cycle === "monthly" && { color: "#fff" }]}>Monthly</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCycle("yearly")} style={[styles.toggleBtn, cycle === "yearly" && styles.toggleBtnActive]} testID="plans-cycle-yearly">
            <Text style={[styles.toggleText, cycle === "yearly" && { color: "#fff" }]}>Yearly · save 17%</Text>
          </TouchableOpacity>
        </View>

        <PlanCard
          name="Basic"
          price={cycle === "monthly" ? 100 : 1000}
          cycle={cycle}
          tag="Email"
          features={PLAN_FEATURES.basic.basic}
          onPick={() => startCheckout("basic")}
          busy={busy === "basic"}
          current={status.plan === "basic"}
          testID="plans-basic"
        />
        <View style={{ height: spacing.md }} />
        <PlanCard
          name="Pro"
          price={cycle === "monthly" ? 200 : 2000}
          cycle={cycle}
          tag="Email + WhatsApp"
          features={[...PLAN_FEATURES.pro.basic, ...PLAN_FEATURES.pro.pro]}
          onPick={() => startCheckout("pro")}
          busy={busy === "pro"}
          current={status.plan === "pro"}
          highlight
          testID="plans-pro"
        />

        <TouchableOpacity onPress={() => router.push("/billing-history")} style={styles.historyBtn} testID="plans-history-btn">
          <Ionicons name="receipt-outline" size={18} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontWeight: "600", marginLeft: 6 }}>Payment history</Text>
        </TouchableOpacity>

        {!status.razorpay_configured ? (
          <Text style={[typography.caption, { marginTop: spacing.md, textAlign: "center" }]}>
            Razorpay keys not set — checkout will be disabled until configured.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PlanCard({ name, price, cycle, tag, features, onPick, busy, current, highlight, testID }: any) {
  return (
    <View style={[styles.planCard, highlight && { borderColor: colors.brand, borderWidth: 2 }]} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Text style={{ fontSize: 20, fontWeight: "700", color: colors.textPrimary }}>{name}</Text>
          <Text style={typography.small}>{tag}</Text>
        </View>
        {current ? <View style={styles.currentPill}><Text style={{ color: "#065F46", fontSize: 10, fontWeight: "700" }}>CURRENT</Text></View> : null}
      </View>
      <View style={{ marginTop: 8, flexDirection: "row", alignItems: "flex-end" }}>
        <Text style={{ fontSize: 32, fontWeight: "800", color: colors.textPrimary }}>₹{price}</Text>
        <Text style={{ ...typography.small, marginLeft: 6, marginBottom: 6 }}>/ {cycle === "monthly" ? "month" : "year"}</Text>
      </View>
      <View style={{ height: spacing.sm }} />
      {features.map((f: string, i: number) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
          <Text style={{ ...typography.body, marginLeft: 6 }}>{f}</Text>
        </View>
      ))}
      <View style={{ height: spacing.md }} />
      <Button title={current ? "Current plan" : `Choose ${name}`} onPress={onPick} loading={busy} disabled={current} testID={`${testID}-choose-btn`} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  toggle: {
    flexDirection: "row", marginVertical: spacing.md,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    padding: 4, backgroundColor: colors.surface,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: "center" },
  toggleBtnActive: { backgroundColor: colors.brand },
  toggleText: { color: colors.textSecondary, fontWeight: "700" },
  planCard: {
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, backgroundColor: colors.surfaceElevated,
  },
  currentPill: { backgroundColor: colors.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  cancelBtn: { marginTop: spacing.md, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.15)" },
  historyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: spacing.lg, padding: 12 },
});
