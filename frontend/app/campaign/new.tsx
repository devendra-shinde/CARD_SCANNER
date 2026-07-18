import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Button, Card, Chip, EmptyState, Input, getInitials, pickColor } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Step = 1 | 2 | 3;
type Contact = { id: string; name: string; company: string; email: string; designation: string; industry?: string; tags?: string[] };
type Template = { id: string; name: string; subject: string; body_html: string };

export default function NewCampaign() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(1);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>("all");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, t] = await Promise.all([
          api<{ items: Contact[] }>("/contacts?limit=500"),
          api<{ items: Template[] }>("/templates"),
        ]);
        setContacts(c.items.filter((x) => !!x.email));
        setTemplates(t.items);
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  const industries = Array.from(new Set(contacts.map((c) => c.industry).filter(Boolean))) as string[];
  const filtered = contacts.filter((c) => {
    if (filter === "all") return true;
    if (filter === "selected") return selected.has(c.id);
    return c.industry === filter;
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  const applyTemplate = (t: Template) => {
    setSubject(t.subject);
    setBody(t.body_html);
    if (!name) setName(t.name);
  };

  const sendNow = async () => {
    if (!name.trim() || !subject.trim() || !body.trim() || selected.size === 0) {
      setErr("Complete all fields and select at least one recipient.");
      return;
    }
    setErr(null);
    setSending(true);
    try {
      const created = await api<any>("/campaigns", {
        method: "POST",
        body: {
          name: name.trim(),
          subject: subject.trim(),
          body_html: body,
          recipient_ids: Array.from(selected),
        },
      });
      const result = await api<any>(`/campaigns/${created.id}/send`, { method: "POST" });
      Alert.alert("Campaign sent", `Sent: ${result.sent}, Failed: ${result.failed}`, [
        { text: "OK", onPress: () => router.replace("/(tabs)/campaigns") },
      ]);
    } catch (e: any) {
      setErr(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="new-campaign-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => (step === 1 ? router.back() : setStep((s) => (s - 1) as Step))} style={styles.iconBtn} testID="campaign-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>New campaign · {step}/3</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.progressWrap}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={[styles.progressBar, step >= s && { backgroundColor: colors.brand }]} />
        ))}
      </View>

      {step === 1 && (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
            <Text style={typography.h3}>Choose recipients</Text>
            <Text style={typography.small}>{selected.size} of {filtered.length} selected · {contacts.length} total</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            <Chip label={`All · ${contacts.length}`} active={filter === "all"} onPress={() => setFilter("all")} testID="campaign-filter-all" />
            {selected.size > 0 && (
              <Chip label={`Selected · ${selected.size}`} active={filter === "selected"} onPress={() => setFilter("selected")} testID="campaign-filter-selected" />
            )}
            {industries.map((ind) => (
              <Chip key={ind} label={ind} active={filter === ind} onPress={() => setFilter(ind)} testID={`campaign-filter-industry-${ind}`} />
            ))}
          </ScrollView>
          <TouchableOpacity onPress={selectAll} style={styles.selectAllBtn} testID="campaign-select-all-btn">
            <Ionicons name={selected.size === filtered.length && filtered.length > 0 ? "checkbox" : "square-outline"} size={18} color={colors.brand} />
            <Text style={{ color: colors.brand, fontWeight: "600", marginLeft: 6 }}>
              {selected.size === filtered.length && filtered.length > 0 ? "Deselect all" : "Select all in filter"}
            </Text>
          </TouchableOpacity>
          {filtered.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No contacts with emails"
              subtitle="Add contacts that have email addresses to send campaigns."
              testID="campaign-empty-recipients"
            />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
              renderItem={({ item }) => {
                const isSel = selected.has(item.id);
                return (
                  <TouchableOpacity
                    onPress={() => toggle(item.id)}
                    style={[styles.recipientRow, isSel && { borderColor: colors.brand, backgroundColor: colors.surface }]}
                    testID={`campaign-recipient-${item.id}`}
                  >
                    <Ionicons name={isSel ? "checkbox" : "square-outline"} size={20} color={isSel ? colors.brand : colors.textTertiary} />
                    <Avatar name={item.name || item.company} size={36} color={pickColor(item.id)} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={typography.bodyStrong} numberOfLines={1}>{item.name || getInitials(item.company)}</Text>
                      <Text style={typography.small} numberOfLines={1}>{item.email}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Button title={`Continue with ${selected.size} recipient${selected.size !== 1 ? "s" : ""}`} onPress={() => setStep(2)} disabled={selected.size === 0} testID="campaign-step1-continue" />
          </View>
        </View>
      )}

      {step === 2 && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
            <Text style={typography.h3}>Compose email</Text>
            <Text style={[typography.small, { marginBottom: spacing.md }]}>Write your message or start from a saved template.</Text>
            {templates.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: spacing.md }}>
                {templates.map((t) => (
                  <TouchableOpacity key={t.id} onPress={() => applyTemplate(t)} style={styles.templateChip} testID={`campaign-use-template-${t.id}`}>
                    <Ionicons name="document-text-outline" size={14} color={colors.brand} />
                    <Text style={{ color: colors.brand, fontWeight: "600", marginLeft: 4 }}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <Input label="Campaign name (internal)" value={name} onChangeText={setName} placeholder="Q3 outreach" testID="campaign-name-input" />
            <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="Quick chat next week?" testID="campaign-subject-input" />
            <Text style={styles.bodyLabel}>Body</Text>
            <View style={styles.bodyWrap}>
              <BodyEditor value={body} onChangeText={setBody} />
            </View>
            <Text style={[typography.caption, { marginTop: 6 }]}>Plain text or basic HTML supported.</Text>
            <View style={{ height: spacing.lg }} />
            <Button title="Preview & send" onPress={() => setStep(3)} disabled={!name || !subject || !body} testID="campaign-step2-continue" />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {step === 3 && (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
          <Text style={typography.h3}>Review & send</Text>
          <Card style={{ marginTop: spacing.md }}>
            <Text style={typography.caption}>SUBJECT</Text>
            <Text style={typography.bodyStrong}>{subject}</Text>
            <View style={{ height: spacing.md }} />
            <Text style={typography.caption}>PREVIEW</Text>
            <View style={styles.previewBox}>
              <Text style={{ color: colors.textPrimary }}>{body}</Text>
            </View>
            <View style={{ height: spacing.md }} />
            <Text style={typography.caption}>RECIPIENTS ({selected.size})</Text>
            <Text style={typography.small} numberOfLines={3}>
              {contacts.filter((c) => selected.has(c.id)).map((c) => c.email).join(", ")}
            </Text>
          </Card>
          {err ? <Text style={{ color: colors.danger, marginTop: spacing.md }} testID="campaign-error">{err}</Text> : null}
          <View style={{ height: spacing.md }} />
          <Button title={sending ? "Sending…" : "Send now"} onPress={sendNow} loading={sending} icon="send" testID="campaign-send-btn" />
          <View style={{ height: spacing.sm }} />
          <Text style={typography.caption}>Uses your SMTP config from Settings → Email sending.</Text>
        </ScrollView>
      )}
    </View>
  );
}

function BodyEditor({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      multiline
      placeholder="Hi {name}, ..."
      placeholderTextColor={colors.textTertiary}
      style={{ minHeight: 200, color: colors.textPrimary, fontSize: 15, textAlignVertical: "top" }}
      testID="campaign-body-input"
    />
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
  progressWrap: { flexDirection: "row", padding: spacing.lg, gap: 8 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  chipsRow: { paddingHorizontal: spacing.lg, gap: 8, height: 56, alignItems: "center" },
  selectAllBtn: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  recipientRow: {
    flexDirection: "row", alignItems: "center",
    padding: 10,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: 8,
    gap: 10,
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  templateChip: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  bodyLabel: {
    ...typography.caption, textTransform: "uppercase", marginBottom: 6,
  },
  bodyWrap: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  previewBox: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    marginTop: 4,
  },
});
