import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, EmptyState, getInitials } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

type Contact = { id: string; name: string; company: string; email: string; phone: string; created_at: string };

export default function Duplicates() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<Contact[][]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api<{ groups: Contact[][] }>("/contacts/duplicates");
      setGroups(res.groups);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const merge = (group: Contact[]) => {
    // Pick oldest as primary (most likely canonical)
    const sorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const primary = sorted[0];
    const dups = sorted.slice(1).map((c) => c.id);
    Alert.alert(
      "Merge duplicates?",
      `Keep ${primary.name || primary.email} and merge ${dups.length} duplicate${dups.length !== 1 ? "s" : ""} into it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge", onPress: async () => {
            setMerging(primary.id);
            try {
              await api("/contacts/merge", { method: "POST", body: { primary_id: primary.id, duplicate_ids: dups } });
              await load();
            } finally { setMerging(null); }
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="duplicates-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="dup-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Duplicate contacts</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl, alignItems: "center" }}><ActivityIndicator /></View>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="No duplicates found"
          subtitle="Your contact list is clean."
          testID="dup-empty-state"
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
          {groups.map((group, gi) => (
            <Card key={gi} style={{ marginBottom: spacing.md }} testID={`dup-group-${gi}`}>
              <Text style={typography.caption}>DUPLICATE SET #{gi + 1}</Text>
              {group.map((c) => (
                <View key={c.id} style={styles.row}>
                  <View style={styles.avatarInitials}><Text style={{ color: "#fff", fontWeight: "700" }}>{getInitials(c.name || c.company)}</Text></View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={typography.bodyStrong} numberOfLines={1}>{c.name || c.company || c.email}</Text>
                    <Text style={typography.small} numberOfLines={1}>{c.email || c.phone}</Text>
                  </View>
                </View>
              ))}
              <View style={{ height: spacing.sm }} />
              <Button title="Merge into one" onPress={() => merge(group)} loading={merging === group[0]?.id} icon="git-merge-outline" testID={`dup-merge-${gi}`} />
            </Card>
          ))}
        </ScrollView>
      )}
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
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  avatarInitials: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
});
