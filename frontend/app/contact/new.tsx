import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Input } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, spacing, typography } from "@/src/theme";

export default function NewContact() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState({
    name: "", designation: "", company: "", email: "", phone: "", website: "",
    address: "", city: "", state: "", country: "", pincode: "", industry: "", tags: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof values, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!values.name && !values.company && !values.email && !values.phone) {
      setErr("Enter at least a name, company, email, or phone.");
      return;
    }
    setSaving(true); setErr(null);
    try {
      await api("/contacts", {
        method: "POST",
        body: {
          ...values,
          tags: values.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          source: "manual",
        },
      });
      router.replace("/(tabs)/contacts");
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="new-contact-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="new-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>New contact</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Input label="Full name" placeholder="Jane Cooper" value={values.name} onChangeText={(v) => set("name", v)} testID="new-name-input" />
          <Input label="Designation" placeholder="Sales Manager" value={values.designation} onChangeText={(v) => set("designation", v)} testID="new-designation-input" />
          <Input label="Company" placeholder="Acme Corp" value={values.company} onChangeText={(v) => set("company", v)} testID="new-company-input" />
          <Input label="Email" placeholder="jane@acme.com" keyboardType="email-address" autoCapitalize="none" value={values.email} onChangeText={(v) => set("email", v)} testID="new-email-input" />
          <Input label="Phone" placeholder="+1 555 123 4567" keyboardType="phone-pad" value={values.phone} onChangeText={(v) => set("phone", v)} testID="new-phone-input" />
          <Input label="Website" placeholder="acme.com" autoCapitalize="none" value={values.website} onChangeText={(v) => set("website", v)} testID="new-website-input" />
          <Input label="Address" placeholder="123 Main St" value={values.address} onChangeText={(v) => set("address", v)} testID="new-address-input" />
          <Input label="City" value={values.city} onChangeText={(v) => set("city", v)} testID="new-city-input" />
          <Input label="State" value={values.state} onChangeText={(v) => set("state", v)} testID="new-state-input" />
          <Input label="Country" value={values.country} onChangeText={(v) => set("country", v)} testID="new-country-input" />
          <Input label="Pincode" placeholder="ZIP / PIN / postal code" keyboardType="number-pad" value={values.pincode} onChangeText={(v) => set("pincode", v)} testID="new-pincode-input" />
          <Input label="Industry" placeholder="Software, Finance…" value={values.industry} onChangeText={(v) => set("industry", v)} testID="new-industry-input" />
          <Input label="Tags (comma separated · case-insensitive)" placeholder="client, vip" value={values.tags} onChangeText={(v) => set("tags", v)} testID="new-tags-input" autoCapitalize="none" />

          {err ? <Text style={{ color: colors.danger }} testID="new-error">{err}</Text> : null}
          <View style={{ height: spacing.md }} />
          <Button title="Save contact" onPress={save} loading={saving} testID="new-save-btn" />
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
