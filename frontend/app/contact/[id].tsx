import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Card } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Contact = {
  id: string; user_id: string;
  name: string; designation: string; company: string;
  email: string; phone: string; website: string;
  address: string; city: string; state: string; country: string; pincode: string;
  industry: string; tags: string[]; notes: string;
  linkedin: string; company_size: string;
  social_links: Record<string, string>;
  source: string; favorite: boolean;
  avatar_b64?: string;
  created_at: string; updated_at: string;
};

const TAB_KEYS = ["info", "notes", "activity", "enrich"] as const;
type TabKey = typeof TAB_KEYS[number];

export default function ContactDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("info");

  useEffect(() => {
    (async () => {
      try {
        const c = await api<Contact>(`/contacts/${id}`);
        setContact(c);
      } catch (e) {
        if (e instanceof ApiError) Alert.alert("Error", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const toggleFav = async () => {
    if (!contact) return;
    const next = !contact.favorite;
    setContact({ ...contact, favorite: next });
    try {
      await api(`/contacts/${contact.id}`, { method: "PUT", body: { favorite: next } });
    } catch {
      setContact({ ...contact, favorite: !next });
    }
  };

  const del = () => {
    if (!contact) return;
    Alert.alert("Delete contact?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await api(`/contacts/${contact.id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            if (e instanceof ApiError) Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!contact) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
        <Text style={typography.body}>Contact not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.accent, fontWeight: "700" }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="contact-detail-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.heroTop}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="detail-back-btn">
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity onPress={toggleFav} style={styles.iconBtn} testID="detail-favorite-btn">
                <Ionicons name={contact.favorite ? "star" : "star-outline"} size={22} color={contact.favorite ? colors.warning : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push({ pathname: "/contact/edit", params: { id: contact.id } })}
                style={styles.iconBtn}
                testID="detail-edit-btn"
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={del} style={styles.iconBtn} testID="detail-delete-btn">
                <Ionicons name="trash-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ alignItems: "center", marginTop: spacing.md }}>
            <Avatar name={contact.name || contact.company} size={88} imageB64={contact.avatar_b64} />
            <Text style={[typography.h2, { color: "#fff", marginTop: spacing.md }]}>{contact.name || "—"}</Text>
            {contact.designation ? <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 4 }}>{contact.designation}</Text> : null}
            {contact.company ? <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 2 }}>{contact.company}</Text> : null}
          </View>

          {/* Quick actions */}
          <View style={styles.quickRow}>
            <QuickBtn icon="call-outline" label="Call" onPress={() => contact.phone && Linking.openURL(`tel:${contact.phone}`)} disabled={!contact.phone} testID="detail-call-btn" />
            <QuickBtn icon="mail-outline" label="Email" onPress={() => contact.email && Linking.openURL(`mailto:${contact.email}`)} disabled={!contact.email} testID="detail-email-btn" />
            <QuickBtn icon="globe-outline" label="Web" onPress={() => contact.website && Linking.openURL(contact.website.startsWith("http") ? contact.website : `https://${contact.website}`)} disabled={!contact.website} testID="detail-web-btn" />
            <QuickBtn icon="logo-linkedin" label="LinkedIn" onPress={() => contact.social_links?.linkedin && Linking.openURL(contact.social_links.linkedin)} disabled={!contact.social_links?.linkedin} testID="detail-linkedin-btn" />
          </View>
        </View>

        <View style={styles.tabsRow} testID="detail-tabs">
          {TAB_KEYS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              testID={`detail-tab-${t}`}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ padding: spacing.lg }}>
          {tab === "info" && <InfoTab contact={contact} />}
          {tab === "notes" && <NotesTab contact={contact} onSaved={(c) => setContact(c)} />}
          {tab === "activity" && <ActivityTab contact={contact} />}
          {tab === "enrich" && <EnrichTab contact={contact} onEnriched={(c) => setContact(c)} />}
        </View>
      </ScrollView>
    </View>
  );
}

function QuickBtn({ icon, label, onPress, disabled, testID }: { icon: any; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.quickBtn, disabled && { opacity: 0.4 }]} testID={testID}>
      <Ionicons name={icon} size={18} color="#fff" />
      <Text style={styles.quickBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Row({ label, value, testID }: { label: string; value?: string; testID?: string }) {
  if (!value) return null;
  return (
    <View style={styles.rowItem} testID={testID}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[typography.body, { marginTop: 2 }]}>{value}</Text>
    </View>
  );
}

function InfoTab({ contact }: { contact: Contact }) {
  return (
    <Card>
      <Row label="Email" value={contact.email} testID="info-email" />
      <Row label="Phone" value={contact.phone} testID="info-phone" />
      <Row label="Website" value={contact.website} testID="info-website" />
      <Row label="Address" value={[contact.address, contact.city, contact.state, contact.country, contact.pincode].filter(Boolean).join(", ")} testID="info-address" />
      <Row label="Industry" value={contact.industry} testID="info-industry" />
      <Row label="Company size" value={contact.company_size} testID="info-size" />
      {contact.tags?.length ? (
        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>Tags</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4, gap: 6 }}>
            {contact.tags.map((t) => (
              <View key={t} style={styles.tagPill}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function NotesTab({ contact, onSaved }: { contact: Contact; onSaved: (c: Contact) => void }) {
  const [text, setText] = useState(contact.notes || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const c = await api<Contact>(`/contacts/${contact.id}`, { method: "PUT", body: { notes: text } });
      onSaved(c);
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <Text style={styles.rowLabel}>Notes</Text>
      <View style={{ marginTop: 8 }}>
        <View style={styles.notesInputWrap}>
          <NotesTextArea value={text} onChangeText={setText} />
        </View>
      </View>
      <TouchableOpacity onPress={save} disabled={saving} style={styles.saveNotesBtn} testID="notes-save-btn">
        {saving ? <ActivityIndicator color={colors.brandText} /> : <Text style={{ color: colors.brandText, fontWeight: "700" }}>Save notes</Text>}
      </TouchableOpacity>
    </Card>
  );
}

function NotesTextArea({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      multiline
      placeholder="Meeting notes, next steps…"
      placeholderTextColor={colors.textTertiary}
      style={{ minHeight: 140, textAlignVertical: "top", color: colors.textPrimary, fontSize: 15 }}
      testID="notes-input"
    />
  );
}

function ActivityTab({ contact }: { contact: Contact }) {
  return (
    <Card>
      <Row label="Source" value={contact.source} />
      <Row label="Added" value={new Date(contact.created_at).toLocaleString()} />
      <Row label="Last updated" value={new Date(contact.updated_at).toLocaleString()} />
    </Card>
  );
}

function EnrichTab({ contact, onEnriched }: { contact: Contact; onEnriched: (c: Contact) => void }) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!contact.website && !contact.company) {
      setErr("Add a website first (edit contact).");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const data = await api<any>("/enrich", { method: "POST", body: { website: contact.website, company: contact.company } });
      setInfo(data);
      // Save enriched fields back
      const updates: any = {
        social_links: { ...contact.social_links, ...(data.socials || {}) },
      };
      if (!contact.industry && data.industry_guess) updates.industry = data.industry_guess;
      if (data.socials?.linkedin && !contact.linkedin) updates.linkedin = data.socials.linkedin;
      const updated = await api<Contact>(`/contacts/${contact.id}`, { method: "PUT", body: updates });
      onEnriched(updated);
    } catch (e: any) {
      setErr(e?.message || "Enrichment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <View style={styles.aiBadge}>
          <Ionicons name="sparkles" size={12} color="#065F46" />
          <Text style={styles.aiBadgeText}>AI ENRICH</Text>
        </View>
      </View>
      <Text style={typography.small}>
        Scrape company website for description, industry, and social profiles.
      </Text>
      <TouchableOpacity onPress={run} disabled={busy} style={styles.enrichBtn} testID="enrich-run-btn">
        {busy ? <ActivityIndicator color={colors.accent} /> : (
          <>
            <Ionicons name="flash-outline" size={16} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: "700", marginLeft: 4 }}>Enrich now</Text>
          </>
        )}
      </TouchableOpacity>
      {err ? <Text style={{ color: colors.danger, marginTop: 8 }}>{err}</Text> : null}
      {info ? (
        <View style={{ marginTop: spacing.md }}>
          <Row label="Description" value={info.description} />
          <Row label="Industry guess" value={info.industry_guess} />
          {info.socials?.linkedin ? <Row label="LinkedIn" value={info.socials.linkedin} /> : null}
          {info.socials?.twitter ? <Row label="Twitter/X" value={info.socials.twitter} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between" },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  quickRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: spacing.lg,
  },
  quickBtn: {
    alignItems: "center", justifyContent: "center",
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  quickBtnText: { color: "#fff", fontSize: 11, marginTop: 4, fontWeight: "600" },
  tabsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  tabBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  tabTextActive: { color: colors.brandText },
  rowItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { ...typography.caption, textTransform: "uppercase" },
  tagPill: { backgroundColor: colors.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  tagText: { fontSize: 11, fontWeight: "700", color: "#065F46" },
  aiBadge: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  aiBadgeText: { color: "#065F46", fontWeight: "700", fontSize: 10, marginLeft: 4 },
  enrichBtn: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#BBF7D0",
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  notesInputWrap: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  saveNotesBtn: {
    marginTop: spacing.md,
    height: 44, borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
});
