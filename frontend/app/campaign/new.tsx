import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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
import { api, ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Step = 1 | 2 | 3;
type Contact = {
  id: string; name: string; company: string; email: string; designation: string;
  industry?: string; tags?: string[]; country?: string; state?: string; city?: string;
};
type Template = { id: string; name: string; subject: string; body_html: string };
type Facets = {
  country: { value: string; count: number }[];
  state: { value: string; count: number }[];
  city: { value: string; count: number }[];
  industry: { value: string; count: number }[];
  tag: { value: string; count: number }[];
};

type FilterState = {
  countries: string[];
  states: string[];
  cities: string[];
  industries: string[];
  tags: string[];
};

const emptyFilter: FilterState = { countries: [], states: [], cities: [], industries: [], tags: [] };

export default function NewCampaign() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(1);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<Template[]>([]);
  const [facets, setFacets] = useState<Facets>({ country: [], state: [], city: [], industry: [], tag: [] });
  const [filters, setFilters] = useState<FilterState>(emptyFilter);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, t, f] = await Promise.all([
          api<{ items: Contact[] }>("/contacts?limit=500"),
          api<{ items: Template[] }>("/templates"),
          api<Facets>("/contacts/facets"),
        ]);
        setContacts(c.items.filter((x) => !!x.email));
        setTemplates(t.items);
        setFacets(f);
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeFilterCount =
    filters.countries.length + filters.states.length + filters.cities.length +
    filters.industries.length + filters.tags.length;

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      if (filters.countries.length && !filters.countries.includes(c.country || "")) return false;
      if (filters.states.length && !filters.states.includes(c.state || "")) return false;
      if (filters.cities.length && !filters.cities.includes(c.city || "")) return false;
      if (filters.industries.length && !filters.industries.includes(c.industry || "")) return false;
      if (filters.tags.length) {
        const ctags = (c.tags || []).map((x) => x.toLowerCase());
        if (!filters.tags.some((t) => ctags.includes(t.toLowerCase()))) return false;
      }
      return true;
    });
  }, [contacts, filters]);

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

  const applyAi = (aiSubject: string, aiBody: string) => {
    setSubject(aiSubject);
    setBody(aiBody);
    setAiOpen(false);
  };

  const sendNow = async () => {
    if (!name.trim() || !subject.trim() || !body.trim() || selected.size === 0) {
      setErr("Complete all fields and select at least one recipient.");
      return;
    }
    setErr(null);
    setSending(true);
    try {
      const created = await api<{ id: string }>("/campaigns", {
        method: "POST",
        body: {
          name: name.trim(),
          subject: subject.trim(),
          body_html: body,
          recipient_ids: Array.from(selected),
        },
      });
      const result = await api<{ sent: number; failed: number }>(`/campaigns/${created.id}/send`, { method: "POST" });
      Alert.alert("Campaign sent", `Sent: ${result.sent}, Failed: ${result.failed}`, [
        { text: "OK", onPress: () => router.replace("/(tabs)/campaigns") },
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && (e.message || "").toLowerCase().includes("smtp")) {
        // Centralized email config prompt — deep link to Settings
        Alert.alert(
          "Set up email sending",
          "Add your SMTP credentials in Settings → Email sending before sending campaigns.",
          [
            { text: "Later", style: "cancel" },
            { text: "Configure now", onPress: () => router.push("/settings/email") },
          ]
        );
      } else {
        setErr(e instanceof ApiError ? e.message : "Send failed");
      }
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
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={typography.h3}>Choose recipients</Text>
              <TouchableOpacity onPress={() => setFiltersOpen(true)} style={styles.filtersBtn} testID="campaign-open-filters">
                <Ionicons name="options-outline" size={16} color={colors.brand} />
                <Text style={{ color: colors.brand, fontWeight: "700", marginLeft: 4 }}>
                  Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={typography.small}>{selected.size} of {filtered.length} selected · {contacts.length} total</Text>
          </View>

          {activeFilterCount > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {[...filters.countries.map((v) => ({ k: "countries", v })),
                ...filters.states.map((v) => ({ k: "states", v })),
                ...filters.cities.map((v) => ({ k: "cities", v })),
                ...filters.industries.map((v) => ({ k: "industries", v })),
                ...filters.tags.map((v) => ({ k: "tags", v }))].map(({ k, v }) => (
                <TouchableOpacity
                  key={`${k}-${v}`}
                  onPress={() => setFilters((prev) => ({
                    ...prev,
                    [k]: (prev as any)[k].filter((x: string) => x !== v),
                  } as FilterState))}
                  style={styles.activeChip}
                  testID={`campaign-filter-chip-${k}-${v}`}
                >
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{v}</Text>
                  <Ionicons name="close" size={12} color="#fff" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setFilters(emptyFilter)} style={styles.clearChip} testID="campaign-clear-filters">
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: "700" }}>Clear all</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          <TouchableOpacity onPress={selectAll} style={styles.selectAllBtn} testID="campaign-select-all-btn">
            <Ionicons name={selected.size === filtered.length && filtered.length > 0 ? "checkbox" : "square-outline"} size={18} color={colors.brand} />
            <Text style={{ color: colors.brand, fontWeight: "600", marginLeft: 6 }}>
              {selected.size === filtered.length && filtered.length > 0 ? "Deselect all" : "Select all in filter"}
            </Text>
          </TouchableOpacity>

          {filtered.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No contacts match"
              subtitle="Adjust filters or add contacts with emails."
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
            <Button
              title={`Continue with ${selected.size} recipient${selected.size !== 1 ? "s" : ""}`}
              onPress={() => setStep(2)}
              disabled={selected.size === 0}
              testID="campaign-step1-continue"
            />
          </View>

          <FilterSheet
            visible={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            facets={facets}
            filters={filters}
            onChange={setFilters}
          />
        </View>
      )}

      {step === 2 && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text style={typography.h3}>Compose email</Text>
              <TouchableOpacity onPress={() => setAiOpen(true)} style={styles.aiBtn} testID="campaign-ai-open">
                <Ionicons name="sparkles" size={14} color={colors.brand} />
                <Text style={{ color: colors.brand, fontWeight: "700", marginLeft: 4 }}>AI assist</Text>
              </TouchableOpacity>
            </View>
            <Text style={[typography.small, { marginBottom: spacing.md }]}>Write your message, use AI, or start from a saved template.</Text>
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
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                placeholder="Hi {name}, ..."
                placeholderTextColor={colors.textTertiary}
                style={{ minHeight: 200, color: colors.textPrimary, fontSize: 15, textAlignVertical: "top" }}
                testID="campaign-body-input"
              />
            </View>
            <Text style={[typography.caption, { marginTop: 6 }]}>Plain text or basic HTML supported. Use {"{name}"} as placeholder.</Text>
            <View style={{ height: spacing.lg }} />
            <Button title="Preview & send" onPress={() => setStep(3)} disabled={!name || !subject || !body} testID="campaign-step2-continue" />
          </ScrollView>

          <AiAssistantSheet
            visible={aiOpen}
            onClose={() => setAiOpen(false)}
            subject={subject}
            body={body}
            onApply={applyAi}
          />
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

/** Bottom-sheet with multi-select filters (Country / State / City / Industry / Tag). */
function FilterSheet({
  visible, onClose, facets, filters, onChange,
}: {
  visible: boolean; onClose: () => void;
  facets: Facets;
  filters: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const [draft, setDraft] = useState<FilterState>(filters);
  useEffect(() => setDraft(filters), [filters, visible]);

  const toggle = (key: keyof FilterState, val: string) => {
    setDraft((prev) => {
      const arr = prev[key];
      return { ...prev, [key]: arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val] };
    });
  };

  const Section = ({ title, keyName, items }: { title: string; keyName: keyof FilterState; items: { value: string; count: number }[] }) => {
    if (!items.length) return null;
    return (
      <View style={{ marginBottom: spacing.md }}>
        <Text style={sheetStyles.sectionTitle}>{title}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {items.map((it) => {
            const active = draft[keyName].includes(it.value);
            return (
              <TouchableOpacity
                key={`${keyName}-${it.value}`}
                onPress={() => toggle(keyName, it.value)}
                style={[sheetStyles.opt, active && sheetStyles.optActive]}
                testID={`filter-${keyName}-${it.value}`}
              >
                <Text style={[sheetStyles.optText, active && { color: "#fff" }]}>{it.value} · {it.count}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sheetStyles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={sheetStyles.sheet} testID="filter-sheet">
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.header}>
            <Text style={typography.h3}>Filters</Text>
            <TouchableOpacity onPress={onClose} testID="filter-close">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}>
            <Section title="Country" keyName="countries" items={facets.country} />
            <Section title="State" keyName="states" items={facets.state} />
            <Section title="City" keyName="cities" items={facets.city} />
            <Section title="Industry" keyName="industries" items={facets.industry} />
            <Section title="Tag" keyName="tags" items={facets.tag} />
          </ScrollView>
          <View style={sheetStyles.footer}>
            <View style={{ flex: 1 }}>
              <Button title="Clear" variant="secondary" onPress={() => setDraft(emptyFilter)} testID="filter-clear" />
            </View>
            <View style={{ width: 8 }} />
            <View style={{ flex: 1 }}>
              <Button title="Apply" onPress={() => { onChange(draft); onClose(); }} testID="filter-apply" />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Bottom-sheet AI writing assistant. */
function AiAssistantSheet({
  visible, onClose, subject, body, onApply,
}: {
  visible: boolean; onClose: () => void;
  subject: string; body: string;
  onApply: (subject: string, body: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<"professional" | "friendly" | "concise" | "persuasive">("professional");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setDraft(null); setErr(null); setBusy(false);
    }
  }, [visible]);

  const run = async (action: string) => {
    setBusy(true); setErr(null);
    try {
      const resp = await api<{ subject: string; body: string }>("/ai/write-email", {
        method: "POST",
        body: {
          action,
          prompt,
          subject: draft?.subject || subject,
          body: draft?.body || body,
          tone,
        },
        timeoutMs: 60000,
      });
      setDraft(resp);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "AI could not generate content. Try again.");
    } finally { setBusy(false); }
  };

  const canRewrite = !!(draft?.body || body);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sheetStyles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={sheetStyles.sheet} testID="ai-assist-sheet">
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.header}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name="sparkles" size={18} color={colors.brand} />
              <Text style={[typography.h3, { marginLeft: 8 }]}>AI writing assistant</Text>
            </View>
            <TouchableOpacity onPress={onClose} testID="ai-close">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text style={sheetStyles.sectionTitle}>Tone</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.md }}>
              {(["professional", "friendly", "concise", "persuasive"] as const).map((tn) => (
                <Chip key={tn} label={tn} active={tone === tn} onPress={() => setTone(tn)} testID={`ai-tone-${tn}`} />
              ))}
            </View>

            <Text style={sheetStyles.sectionTitle}>Prompt (for generate)</Text>
            <View style={sheetStyles.promptWrap}>
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                multiline
                placeholder="e.g. Introduce our SaaS to sales managers at manufacturing companies"
                placeholderTextColor={colors.textTertiary}
                style={{ minHeight: 80, color: colors.textPrimary, fontSize: 15, textAlignVertical: "top" }}
                testID="ai-prompt-input"
              />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md }}>
              <TouchableOpacity style={sheetStyles.actionBtn} onPress={() => run("generate")} testID="ai-generate-btn">
                <Ionicons name="add-circle-outline" size={16} color={colors.brand} />
                <Text style={sheetStyles.actionText}>Generate from prompt</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sheetStyles.actionBtn, !canRewrite && { opacity: 0.4 }]} onPress={() => canRewrite && run("rewrite")} testID="ai-rewrite-btn">
                <Ionicons name="refresh-outline" size={16} color={colors.brand} />
                <Text style={sheetStyles.actionText}>Rewrite</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sheetStyles.actionBtn, !canRewrite && { opacity: 0.4 }]} onPress={() => canRewrite && run("shorten")} testID="ai-shorten-btn">
                <Ionicons name="contract-outline" size={16} color={colors.brand} />
                <Text style={sheetStyles.actionText}>Shorten</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sheetStyles.actionBtn, !canRewrite && { opacity: 0.4 }]} onPress={() => canRewrite && run("expand")} testID="ai-expand-btn">
                <Ionicons name="expand-outline" size={16} color={colors.brand} />
                <Text style={sheetStyles.actionText}>Expand</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sheetStyles.actionBtn, !canRewrite && { opacity: 0.4 }]} onPress={() => canRewrite && run("formalize")} testID="ai-formalize-btn">
                <Ionicons name="briefcase-outline" size={16} color={colors.brand} />
                <Text style={sheetStyles.actionText}>More formal</Text>
              </TouchableOpacity>
            </View>

            {busy ? (
              <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
                <ActivityIndicator color={colors.brand} />
                <Text style={[typography.small, { marginTop: 6 }]}>Generating…</Text>
              </View>
            ) : null}

            {err ? <Text style={{ color: colors.danger, marginTop: spacing.md }} testID="ai-error">{err}</Text> : null}

            {draft ? (
              <View style={{ marginTop: spacing.lg }} testID="ai-draft">
                <Text style={typography.caption}>DRAFT SUBJECT</Text>
                <Text style={typography.bodyStrong}>{draft.subject}</Text>
                <View style={{ height: spacing.sm }} />
                <Text style={typography.caption}>DRAFT BODY</Text>
                <View style={sheetStyles.previewBox}>
                  <Text style={{ color: colors.textPrimary }}>{draft.body}</Text>
                </View>
                <Text style={[typography.caption, { marginTop: 4 }]}>AI-generated — review before sending.</Text>
                <View style={{ height: spacing.md }} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Regenerate" variant="secondary" onPress={() => run("rewrite")} testID="ai-regenerate-btn" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Use this" icon="checkmark" onPress={() => onApply(draft.subject, draft.body)} testID="ai-use-btn" />
                  </View>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  chipsRow: { paddingHorizontal: spacing.lg, gap: 8, paddingVertical: 8, alignItems: "center" },
  filtersBtn: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.brand,
    backgroundColor: colors.surface,
  },
  activeChip: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.brand,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  clearChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
    flexShrink: 0,
  },
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
  aiBtn: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: "#BBF7D0",
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

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: "88%",
    minHeight: "50%",
  },
  handle: {
    alignSelf: "center",
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 10,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sectionTitle: { ...typography.caption, textTransform: "uppercase", marginBottom: 6 },
  opt: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  optText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  promptWrap: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  actionBtn: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.brand,
    backgroundColor: colors.surface,
    gap: 4,
  },
  actionText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  previewBox: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    marginTop: 4,
  },
});
