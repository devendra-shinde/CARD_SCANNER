import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function BillingHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: any[] }>("/billing/history");
      setItems(r.items);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="billing-history-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="bh-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Payment history</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        {loading ? <ActivityIndicator /> :
          items.length === 0 ? <Text style={typography.small}>No payments yet.</Text> :
          items.map((it, i) => (
            <Card key={i} style={{ marginBottom: spacing.sm }} testID={`billing-item-${i}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={typography.bodyStrong}>{it.plan?.toUpperCase()} · {it.cycle}</Text>
                <Text style={typography.bodyStrong}>₹{(it.amount || 0) / 100}</Text>
              </View>
              <Text style={typography.small}>{it.paid_at ? new Date(it.paid_at).toLocaleString() : ""}</Text>
              <Text style={{ ...typography.caption, marginTop: 4 }}>Payment ID: {it.payment_id}</Text>
            </Card>
          ))
        }
      </ScrollView>
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
});
