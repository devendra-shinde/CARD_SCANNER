import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Input } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

export default function EditContact() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [values, setValues] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await api<any>(`/contacts/${id}`);
        setValues({
          ...c,
          tags_str: (c.tags || []).join(", "),
        });
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const set = (k: string, v: string) => setValues((prev: any) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const body: any = {
        name: values.name, designation: values.designation, company: values.company,
        email: values.email, phone: values.phone, website: values.website,
        address: values.address, city: values.city, state: values.state, country: values.country,
        industry: values.industry,
        tags: (values.tags_str || "").split(",").map((t: string) => t.trim()).filter(Boolean),
      };
      await api(`/contacts/${id}`, { method: "PUT", body });
      router.back();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  if (loading || !values) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="edit-contact-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="edit-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Edit contact</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Input label="Full name" value={values.name} onChangeText={(v) => set("name", v)} testID="edit-name-input" />
          <Input label="Designation" value={values.designation} onChangeText={(v) => set("designation", v)} testID="edit-designation-input" />
          <Input label="Company" value={values.company} onChangeText={(v) => set("company", v)} testID="edit-company-input" />
          <Input label="Email" value={values.email} onChangeText={(v) => set("email", v)} keyboardType="email-address" autoCapitalize="none" testID="edit-email-input" />
          <Input label="Phone" value={values.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" testID="edit-phone-input" />
          <Input label="Website" value={values.website} onChangeText={(v) => set("website", v)} autoCapitalize="none" testID="edit-website-input" />
          <Input label="Address" value={values.address} onChangeText={(v) => set("address", v)} testID="edit-address-input" />
          <Input label="City" value={values.city} onChangeText={(v) => set("city", v)} testID="edit-city-input" />
          <Input label="Country" value={values.country} onChangeText={(v) => set("country", v)} testID="edit-country-input" />
          <Input label="Industry" value={values.industry} onChangeText={(v) => set("industry", v)} testID="edit-industry-input" />
          <Input label="Tags (comma separated)" value={values.tags_str} onChangeText={(v) => set("tags_str", v)} autoCapitalize="none" testID="edit-tags-input" />
          {err ? <Text style={{ color: colors.danger }} testID="edit-error">{err}</Text> : null}
          <View style={{ height: spacing.md }} />
          <Button title="Save changes" onPress={save} loading={saving} testID="edit-save-btn" />
        </ScrollView>
      </KeyboardAvoidingView>
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
});
