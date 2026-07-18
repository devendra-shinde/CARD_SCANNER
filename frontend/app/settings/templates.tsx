import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, EmptyState, Input } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

type Template = { id: string; name: string; subject: string; body_html: string };

export default function Templates() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Template[] }>("/templates");
      setItems(res.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!name || !subject || !body) return;
    setSaving(true);
    try {
      await api("/templates", { method: "POST", body: { name, subject, body_html: body } });
      setName(""); setSubject(""); setBody("");
      setShowForm(false);
      await load();
    } finally { setSaving(false); }
  };

  const del = (t: Template) => {
    Alert.alert("Delete template?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await api(`/templates/${t.id}`, { method: "DELETE" }); load(); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="templates-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="templates-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Email templates</Text>
        <TouchableOpacity onPress={() => setShowForm((s) => !s)} style={[styles.iconBtn, { backgroundColor: colors.brand }]} testID="templates-add-btn">
          <Ionicons name={showForm ? "close" : "add"} size={22} color={colors.brandText} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {showForm && (
            <Card>
              <Input label="Template name" value={name} onChangeText={setName} testID="templates-name-input" placeholder="Intro outreach" />
              <Input label="Subject" value={subject} onChangeText={setSubject} testID="templates-subject-input" placeholder="Quick chat next week?" />
              <Text style={{ ...typography.caption, marginBottom: 6 }}>BODY</Text>
              <View style={styles.bodyWrap}><BodyArea value={body} onChangeText={setBody} /></View>
              <View style={{ height: spacing.md }} />
              <Button title="Save template" onPress={create} loading={saving} disabled={!name || !subject || !body} testID="templates-save-btn" />
            </Card>
          )}

          {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} /> : items.length === 0 ? (
            <EmptyState
              icon="document-text-outline"
              title="No templates yet"
              subtitle="Save your best-performing emails to reuse them across campaigns."
              action={{ label: "Add template", onPress: () => setShowForm(true), testID: "templates-empty-add" }}
              testID="templates-empty-state"
            />
          ) : (
            items.map((t) => (
              <Card key={t.id} style={{ marginTop: spacing.sm }} testID={`template-item-${t.id}`}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={typography.bodyStrong}>{t.name}</Text>
                    <Text style={typography.small} numberOfLines={1}>{t.subject}</Text>
                  </View>
                  <TouchableOpacity onPress={() => del(t)} testID={`template-delete-${t.id}`}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function BodyArea({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      multiline
      placeholder="Hi {name}, ..."
      placeholderTextColor={colors.textTertiary}
      style={{ minHeight: 140, color: colors.textPrimary, fontSize: 15, textAlignVertical: "top" }}
      testID="templates-body-input"
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
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  bodyWrap: {
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: spacing.sm, backgroundColor: colors.surface,
  },
});
