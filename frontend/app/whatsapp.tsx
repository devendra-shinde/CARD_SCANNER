import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Button, Card, Chip, EmptyState, getInitials, pickColor } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Contact = { id: string; name: string; company: string; email: string; phone: string; designation?: string };

/**
 * WhatsApp campaign — Pro-only.
 *
 * Flow (no WhatsApp Business API required):
 *   1. User selects contacts with phone numbers.
 *   2. Picks or types a template with {{ContactName}} / {{CompanyName}} / {{Designation}} variables.
 *   3. Backend returns per-contact wa.me deep-links (personalized).
 *   4. User launches WhatsApp for each contact — one tap per recipient.
 */
export default function WhatsAppCampaignScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("Hi {{ContactName}}, hope you’re doing well at {{CompanyName}}!");
  const [links, setLinks] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<string>("free");

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          api<{ items: Contact[] }>("/contacts?limit=500"),
          api<{ plan: string }>("/billing/status"),
        ]);
        setContacts(c.items.filter((x) => !!x.phone));
        setPlan(s.plan);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const isPro = plan === "pro";

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const generate = async () => {
    if (!isPro) {
      Alert.alert("Pro feature", "WhatsApp campaigns are on the Pro plan.", [
        { text: "Cancel", style: "cancel" },
        { text: "See plans", onPress: () => router.push("/plans") },
      ]);
      return;
    }
    if (selected.size === 0 || !body.trim()) return;
    setBusy(true);
    try {
      const resp = await api<{ items: any[] }>("/whatsapp/generate-links", {
        method: "POST",
        body: { body, contact_ids: Array.from(selected) },
      });
      setLinks(resp.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        Alert.alert("Pro feature", e.message);
      } else {
        Alert.alert("Error", (e as any)?.message || "Failed");
      }
    } finally { setBusy(false); }
  };

  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="whatsapp-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="wa-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
          <Text style={[typography.bodyStrong, { marginLeft: 6 }]}>WhatsApp Campaign</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {!isPro ? (
        <View style={{ padding: spacing.lg }}>
          <Card style={{ backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }} testID="wa-upgrade-card">
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <Ionicons name="star" size={16} color="#92400E" />
              <Text style={{ ...typography.bodyStrong, color: "#92400E", marginLeft: 6 }}>Pro plan required</Text>
            </View>
            <Text style={{ ...typography.small, color: "#92400E" }}>
              Bulk WhatsApp messaging (with variables, templates, and one-tap launch) is a Pro feature.
              You can preview the flow here, but generating personalized links is disabled on Free/Basic.
            </Text>
            <View style={{ height: spacing.sm }} />
            <Button title="See Pro plan" onPress={() => router.push("/plans")} testID="wa-upgrade-btn" />
          </Card>
        </View>
      ) : null}

      {!links ? (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
            <Text style={typography.h3}>Message</Text>
            <Text style={[typography.small, { marginBottom: spacing.sm }]}>
              Use variables: {"{{ContactName}}"}, {"{{CompanyName}}"}, {"{{Designation}}"}
            </Text>
            <View style={styles.bodyWrap}>
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                placeholder="Hi {{ContactName}}, ..."
                placeholderTextColor={colors.textTertiary}
                style={{ minHeight: 120, color: colors.textPrimary, fontSize: 15, textAlignVertical: "top" }}
                testID="wa-body-input"
              />
            </View>

            <View style={{ height: spacing.md }} />
            <Text style={typography.h3}>Recipients ({selected.size} / {contacts.length})</Text>
            <Text style={[typography.small, { marginBottom: spacing.sm }]}>Only contacts with a phone number are shown.</Text>

            {contacts.length === 0 ? (
              <EmptyState
                icon="phone-portrait-outline"
                title="No contacts with phone numbers"
                subtitle="Add or scan contacts that include a mobile number to send WhatsApp messages."
                testID="wa-empty-state"
              />
            ) : (
              contacts.map((c) => {
                const isSel = selected.has(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => toggle(c.id)}
                    style={[styles.row, isSel && { borderColor: "#25D366", backgroundColor: colors.surface }]}
                    testID={`wa-recipient-${c.id}`}
                  >
                    <Ionicons name={isSel ? "checkbox" : "square-outline"} size={20} color={isSel ? "#25D366" : colors.textTertiary} />
                    <Avatar name={c.name || c.company} size={36} color={pickColor(c.id)} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={typography.bodyStrong} numberOfLines={1}>{c.name || getInitials(c.company)}</Text>
                      <Text style={typography.small} numberOfLines={1}>{c.phone}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Button
              title={`Generate ${selected.size} link${selected.size !== 1 ? "s" : ""}`}
              onPress={generate}
              disabled={selected.size === 0 || !body.trim()}
              loading={busy}
              icon="link-outline"
              testID="wa-generate-btn"
            />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
            <Text style={typography.h3}>Launch messages</Text>
            <TouchableOpacity onPress={() => setLinks(null)} style={styles.linkBtn} testID="wa-back-to-compose">
              <Ionicons name="chevron-back" size={16} color={colors.brand} />
              <Text style={{ color: colors.brand, fontWeight: "700" }}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={[typography.small, { marginBottom: spacing.md }]}>
            Tap each row to open WhatsApp with the personalized message pre-filled — you press Send in WhatsApp.
          </Text>
          {links.map((it, i) => (
            <TouchableOpacity
              key={it.contact_id}
              onPress={() => Linking.openURL(it.url)}
              style={styles.linkCard}
              testID={`wa-launch-${it.contact_id}`}
            >
              <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={typography.bodyStrong} numberOfLines={1}>{it.name}</Text>
                <Text style={typography.small} numberOfLines={2}>{it.personalized}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
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
  bodyWrap: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    padding: 10, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, marginBottom: 8, gap: 10,
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  linkCard: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    marginBottom: 8,
  },
  linkBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface },
});
