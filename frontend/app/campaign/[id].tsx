import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function CampaignDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<any>(`/campaigns/${id}`);
        setC(data);
      } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
  if (!c) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="campaign-detail-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="campaign-detail-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong} numberOfLines={1}>{c.name}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={styles.statPill}><Text style={styles.statLabel}>Recipients</Text><Text style={styles.statVal}>{c.recipient_count}</Text></View>
          <View style={[styles.statPill, { backgroundColor: colors.accentSoft }]}><Text style={styles.statLabel}>Sent</Text><Text style={[styles.statVal, { color: "#065F46" }]}>{c.sent_count}</Text></View>
          <View style={[styles.statPill, { backgroundColor: c.failed_count ? colors.dangerSoft : colors.surface }]}><Text style={styles.statLabel}>Failed</Text><Text style={[styles.statVal, { color: c.failed_count ? colors.danger : colors.textPrimary }]}>{c.failed_count}</Text></View>
        </View>
        <Card style={{ marginTop: spacing.md }}>
          <Text style={typography.caption}>SUBJECT</Text>
          <Text style={typography.bodyStrong}>{c.subject}</Text>
        </Card>
        <Card style={{ marginTop: spacing.md }}>
          <Text style={typography.caption}>BODY</Text>
          <Text style={typography.body}>{c.body_html}</Text>
        </Card>
        <Card style={{ marginTop: spacing.md }}>
          <Text style={typography.caption}>RECIPIENTS ({c.recipient_emails.length})</Text>
          <Text style={typography.small}>{c.recipient_emails.join(", ")}</Text>
        </Card>
      </ScrollView>
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
  statPill: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  statLabel: { ...typography.caption, textTransform: "uppercase" },
  statVal: { fontSize: 20, fontWeight: "700", color: colors.textPrimary, marginTop: 4 },
});
