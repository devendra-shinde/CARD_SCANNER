import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Card, Chip, EmptyState, getInitials, pickColor } from "@/src/components/ui";
import { useT } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Contact = {
  id: string; name: string; company: string; designation: string;
  email: string; phone: string; tags?: string[]; industry?: string; favorite?: boolean;
};

export default function ContactsList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [items, setItems] = useState<Contact[]>([]);
  const [dupIds, setDupIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const FILTERS = useMemo(
    () => [
      { id: "all", label: t("filter_all") },
      { id: "recent", label: t("filter_recent") },
      { id: "favorites", label: t("filter_favorites") },
      { id: "client", label: t("filter_client") },
      { id: "vip", label: t("filter_vip") },
      { id: "lead", label: t("filter_lead") },
    ],
    [t]
  );

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (filter === "favorites") params.set("favorite", "true");
      else if (filter !== "all" && filter !== "recent") params.set("tag", filter);
      if (filter === "recent") params.set("sort", "recent");
      const q = params.toString();
      const [res, dupRes] = await Promise.all([
        api<{ items: Contact[] }>(`/contacts${q ? "?" + q : ""}`),
        api<{ groups: { id: string }[][] }>("/contacts/duplicates").catch(() => ({ groups: [] })),
      ]);
      setItems(res.items);
      const ids = new Set<string>();
      (dupRes.groups || []).forEach((g) => g.forEach((c) => ids.add(c.id)));
      setDupIds(ids);
    } catch {} finally {
      setLoading(false);
    }
  }, [search, filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const grouped = useMemo(() => {
    if (filter === "recent") return items;
    return [...items].sort((a, b) => (a.name || a.company || "").localeCompare(b.name || b.company || ""));
  }, [items, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="contacts-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
          <Text style={typography.h2}>{t("contacts_title")}</Text>
          <TouchableOpacity
            onPress={() => router.push("/contact/new")}
            style={styles.addBtn}
            testID="contacts-add-btn"
          >
            <Ionicons name="add" size={22} color={colors.brandText} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap} testID="contacts-search-wrap">
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            placeholder={t("contacts_search_placeholder")}
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            testID="contacts-search-input"
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch("")} testID="contacts-search-clear">
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          testID="contacts-filter-row"
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              active={filter === f.id}
              onPress={() => setFilter(f.id)}
              testID={`contacts-filter-${f.id}`}
            />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl, alignItems: "center" }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={t("empty_no_contacts_title")}
          subtitle={search ? t("contacts_empty_search") : t("empty_no_contacts_sub")}
          action={{ label: t("quick_add_contact"), onPress: () => router.push("/contact/new"), testID: "contacts-empty-add" }}
          testID="contacts-empty-state"
        />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 140, paddingTop: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => {
            const isDup = dupIds.has(item.id);
            return (
              <Card
                onPress={() => router.push({ pathname: "/contact/[id]", params: { id: item.id } })}
                style={{ marginBottom: spacing.sm, flexDirection: "row", alignItems: "center" }}
                testID={`contact-item-${item.id}`}
              >
                <Avatar name={item.name || item.company} size={44} color={pickColor(item.id)} />
                <View style={{ marginLeft: spacing.md, flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                    <Text style={typography.bodyStrong} numberOfLines={1}>{item.name || getInitials(item.company)}</Text>
                    {item.favorite ? (
                      <Ionicons name="star" size={14} color={colors.warning} style={{ marginLeft: 6 }} />
                    ) : null}
                    {isDup ? (
                      <View style={styles.dupBadge} testID={`contact-dup-badge-${item.id}`}>
                        <Ionicons name="copy-outline" size={10} color={colors.danger} />
                        <Text style={styles.dupBadgeText}>{t("duplicate_badge")}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[typography.small, { marginTop: 2 }]} numberOfLines={1}>
                    {item.designation ? `${item.designation} · ` : ""}{item.company || item.email || item.phone}
                  </Text>
                </View>
                {item.industry ? (
                  <View style={styles.tagPill}>
                    <Text style={styles.tagText} numberOfLines={1}>{item.industry}</Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                )}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, height: 44,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  chipsRow: {
    gap: 8,
    paddingRight: spacing.lg,
    height: 56,
    alignItems: "center",
  },
  tagPill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.sm,
    maxWidth: 90,
  },
  tagText: {
    fontSize: 11, fontWeight: "700", color: "#065F46",
  },
  dupBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.sm,
    marginLeft: 6,
    gap: 3,
  },
  dupBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.danger,
    letterSpacing: 0.5,
  },
});
