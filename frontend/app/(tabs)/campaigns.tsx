import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, EmptyState } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Campaign = {
  id: string; name: string; subject: string; status: string;
  recipient_count: number; sent_count: number; failed_count: number;
  created_at: string; sent_at?: string;
};

export default function CampaignsList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Campaign[] }>("/campaigns");
      setItems(res.items);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="campaigns-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={typography.h2}>Campaigns</Text>
          <TouchableOpacity
            onPress={() => router.push("/campaign/new")}
            style={styles.addBtn}
            testID="campaigns-new-btn"
          >
            <Ionicons name="add" size={22} color={colors.brandText} />
          </TouchableOpacity>
        </View>
        <Text style={[typography.small, { marginTop: spacing.xs }]}>
          Send targeted emails to your contacts. Anti-spam: max 3 per recipient/week.
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl, alignItems: "center" }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="mail-outline"
          title="No campaigns yet"
          subtitle="Create your first campaign to email a targeted group of contacts."
          action={{ label: "Create campaign", onPress: () => router.push("/campaign/new"), testID: "campaigns-empty-new" }}
          testID="campaigns-empty-state"
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
          renderItem={({ item }) => (
            <Card
              onPress={() => router.push({ pathname: "/campaign/[id]", params: { id: item.id } })}
              style={{ marginBottom: spacing.sm }}
              testID={`campaign-item-${item.id}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                <View style={[styles.statusPill, item.status === "sent" ? styles.pillSent : styles.pillDraft]}>
                  <Text style={item.status === "sent" ? styles.pillSentText : styles.pillDraftText}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={{ ...typography.caption, marginLeft: 8 }}>
                  {new Date(item.sent_at || item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={typography.bodyStrong} numberOfLines={1}>{item.name}</Text>
              <Text style={[typography.small, { marginTop: 2 }]} numberOfLines={1}>{item.subject}</Text>
              <View style={styles.metricsRow}>
                <Metric label="Recipients" value={item.recipient_count} />
                <Metric label="Sent" value={item.sent_count} tone="success" />
                <Metric label="Failed" value={item.failed_count} tone={item.failed_count ? "danger" : "muted"} />
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "muted" }) {
  const color = tone === "success" ? colors.accent : tone === "danger" ? colors.danger : colors.textPrimary;
  return (
    <View style={{ flex: 1 }}>
      <Text style={typography.caption}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: "700", color, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm,
  },
  pillSent: { backgroundColor: colors.accentSoft },
  pillSentText: { color: "#065F46", fontWeight: "700", fontSize: 10 },
  pillDraft: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pillDraftText: { color: colors.textSecondary, fontWeight: "700", fontSize: 10 },
  metricsRow: {
    flexDirection: "row",
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});
