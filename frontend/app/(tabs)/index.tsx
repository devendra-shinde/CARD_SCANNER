import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Card, EmptyState, SectionHeader, getInitials, pickColor } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Analytics = {
  contacts_total: number;
  scans_this_month: number;
  campaigns_total: number;
  emails_sent: number;
};

type Contact = {
  id: string; name: string; company: string; designation: string; email: string; phone: string;
};

export default function Home() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [recent, setRecent] = useState<Contact[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([
        api<Analytics>("/analytics"),
        api<{ items: Contact[] }>("/contacts?sort=recent&limit=5"),
      ]);
      setAnalytics(a);
      setRecent(c.items);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      testID="home-scroll"
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={typography.caption}>WELCOME BACK</Text>
          <Text style={[typography.h2, { marginTop: 2 }]}>{user?.name?.split(" ")[0] || "there"}</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/(tabs)/settings")}
          style={styles.avatarBtn}
          testID="home-profile-btn"
        >
          <Avatar name={user?.name || "?"} size={44} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsGrid}>
        <StatCard label="Contacts" value={analytics?.contacts_total ?? 0} icon="people" testID="stat-contacts" />
        <StatCard label="Scans / mo" value={analytics?.scans_this_month ?? 0} icon="scan" testID="stat-scans" accent />
        <StatCard label="Campaigns" value={analytics?.campaigns_total ?? 0} icon="mail" testID="stat-campaigns" />
        <StatCard label="Emails sent" value={analytics?.emails_sent ?? 0} icon="send" testID="stat-emails" />
      </View>

      <SectionHeader
        title="Quick actions"
      />
      <View style={styles.quickRow}>
        <QuickAction icon="scan-outline" label="Scan card" onPress={() => router.push("/scan")} testID="quick-scan" />
        <QuickAction icon="add-outline" label="Add contact" onPress={() => router.push("/contact/new")} testID="quick-add-contact" />
        <QuickAction icon="mail-outline" label="New campaign" onPress={() => router.push("/campaign/new")} testID="quick-new-campaign" />
        <QuickAction icon="bar-chart-outline" label="Analytics" onPress={() => router.push("/analytics")} testID="quick-analytics" />
      </View>

      <SectionHeader
        title="Recent contacts"
        action={{ label: "View all", onPress: () => router.push("/(tabs)/contacts"), testID: "home-view-all-contacts" }}
      />
      <View style={{ paddingHorizontal: spacing.lg }}>
        {recent.length === 0 ? (
          <EmptyState
            icon="person-add-outline"
            title="No contacts yet"
            subtitle="Scan a business card or add someone manually."
            action={{ label: "Scan a card", onPress: () => router.push("/scan"), testID: "home-empty-scan-btn" }}
            testID="home-empty-state"
          />
        ) : (
          recent.map((c) => (
            <Card
              key={c.id}
              onPress={() => router.push({ pathname: "/contact/[id]", params: { id: c.id } })}
              style={{ marginBottom: spacing.sm, flexDirection: "row", alignItems: "center" }}
              testID={`home-recent-${c.id}`}
            >
              <Avatar name={c.name || c.company} size={44} color={pickColor(c.id)} />
              <View style={{ marginLeft: spacing.md, flex: 1 }}>
                <Text style={typography.bodyStrong} numberOfLines={1}>{c.name || getInitials(c.company)}</Text>
                <Text style={[typography.small, { marginTop: 2 }]} numberOfLines={1}>
                  {c.designation ? `${c.designation} · ` : ""}{c.company || c.email}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Card>
          ))
        )}
      </View>

      <TouchableOpacity onPress={logout} style={{ alignSelf: "center", marginTop: spacing.xl }} testID="home-logout-btn">
        <Text style={{ color: colors.textTertiary }}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatCard({ label, value, icon, accent, testID }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; accent?: boolean; testID?: string }) {
  return (
    <View style={styles.statOuter}>
      <View style={[styles.statInner, accent && { backgroundColor: colors.brand, borderColor: colors.brand }]} testID={testID}>
        <View style={styles.statHeader}>
          <Ionicons name={icon} size={18} color={accent ? "#fff" : colors.textSecondary} />
          <Text style={[styles.statLabel, accent && { color: "rgba(255,255,255,0.75)" }]}>{label}</Text>
        </View>
        <Text style={[styles.statValue, accent && { color: "#fff" }]}>{value.toLocaleString()}</Text>
      </View>
    </View>
  );
}

function QuickAction({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.85} testID={testID}>
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={22} color={colors.brand} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  avatarBtn: { width: 44, height: 44 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  statOuter: { width: "50%", padding: 4 },
  statInner: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
  },
  statHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  statLabel: {
    ...typography.caption,
    marginLeft: 8,
  },
  statValue: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, marginTop: 8 },
  quickRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  quickCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  quickIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  quickLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
    textAlign: "center",
  },
});

// Overwrite stat cards: they were laid out incorrectly above (width 50% but padded).
// We rewrite once for clarity here — replace the returned block above by giving
// StatCard its own outer wrapper below.
