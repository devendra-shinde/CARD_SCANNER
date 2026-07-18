import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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

import { Button, Card } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type OcrData = {
  raw_text: string;
  name: string; designation: string; company: string;
  email: string; phone: string; website: string;
  address: string; city: string; state: string; country: string; pincode: string;
  industry: string;
  confidence: string;
};

const FIELDS: { key: keyof OcrData; label: string; placeholder: string; keyboard?: any; icon: any }[] = [
  { key: "name", label: "Full name", placeholder: "Jane Cooper", icon: "person-outline" },
  { key: "designation", label: "Designation", placeholder: "Sales Manager", icon: "briefcase-outline" },
  { key: "company", label: "Company", placeholder: "Acme Corp", icon: "business-outline" },
  { key: "email", label: "Email", placeholder: "jane@acme.com", keyboard: "email-address", icon: "mail-outline" },
  { key: "phone", label: "Phone", placeholder: "+1 555 123 4567", keyboard: "phone-pad", icon: "call-outline" },
  { key: "website", label: "Website", placeholder: "acme.com", keyboard: "url", icon: "link-outline" },
  { key: "address", label: "Address", placeholder: "123 Main St", icon: "location-outline" },
  { key: "city", label: "City", placeholder: "San Francisco", icon: "map-outline" },
  { key: "state", label: "State", placeholder: "CA", icon: "map-outline" },
  { key: "country", label: "Country", placeholder: "USA", icon: "flag-outline" },
  { key: "pincode", label: "Pincode", placeholder: "ZIP / PIN / postal code", keyboard: "number-pad", icon: "pin-outline" },
  { key: "industry", label: "Industry", placeholder: "Software", icon: "layers-outline" },
];

export default function ScanReview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, image } = useLocalSearchParams<{ data: string; image: string }>();
  const initial = useMemo<OcrData>(() => {
    try {
      const parsed = JSON.parse(String(data)) as OcrData;
      return parsed;
    } catch {
      return {
        raw_text: "", name: "", designation: "", company: "",
        email: "", phone: "", website: "",
        address: "", city: "", state: "", country: "", pincode: "",
        industry: "", confidence: "medium",
      };
    }
  }, [data]);

  const [values, setValues] = useState<OcrData>(initial);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof OcrData, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const runEnrich = async () => {
    if (!values.website && !values.company) {
      setEnrichNote("Add a website or company first.");
      return;
    }
    setEnriching(true);
    setEnrichNote(null);
    try {
      const enrich = await api<any>("/enrich", { method: "POST", body: { website: values.website, company: values.company } });
      const socials = enrich.socials || {};
      setValues((v) => ({
        ...v,
        industry: v.industry || enrich.industry_guess || "",
        website: v.website || enrich.website || "",
      }));
      setEnrichNote(
        [
          enrich.site_name ? `Site: ${enrich.site_name}` : null,
          enrich.industry_guess ? `Industry: ${enrich.industry_guess}` : null,
          socials.linkedin ? `LinkedIn found` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "No extra info detected."
      );
      // stash socials into a temporary variable via values state (we'll pass to save)
      (values as any)._socials = socials;
    } catch (e: any) {
      setEnrichNote(e?.message || "Enrichment failed");
    } finally {
      setEnriching(false);
    }
  };

  const save = async () => {
    if (!values.name && !values.company && !values.email && !values.phone) {
      setErr("Add at least one identifier: name, company, email, or phone.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api("/contacts", {
        method: "POST",
        body: {
          ...values,
          source: "ocr",
          image_b64: null,
          social_links: (values as any)._socials || {},
        },
      });
      router.replace("/(tabs)/contacts");
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="scan-review-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="review-close-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Review card</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {image ? (
            <View style={styles.imageWrap}>
              <Image source={{ uri: String(image) }} style={styles.image} resizeMode="cover" />
              <View style={styles.confidenceBadge}>
                <View style={styles.confidenceDot} />
                <Text style={styles.confidenceText}>{values.confidence === "high" ? "High confidence" : "Verify fields"}</Text>
              </View>
            </View>
          ) : null}

          <View style={{ paddingHorizontal: spacing.lg }}>
            {/* AI Enrich */}
            <Card style={styles.enrichCard} testID="review-enrich-card">
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
                <View style={styles.aiBadge}>
                  <Ionicons name="sparkles" size={12} color="#065F46" />
                  <Text style={styles.aiBadgeText}>AI ENRICH</Text>
                </View>
                <Text style={{ ...typography.caption, marginLeft: spacing.sm }}>Website scraping</Text>
              </View>
              <Text style={typography.small}>
                We&apos;ll scan the company website for industry, description, and social links.
              </Text>
              {enrichNote ? (
                <Text style={{ ...typography.small, marginTop: 6, color: colors.textPrimary }} testID="review-enrich-note">
                  {enrichNote}
                </Text>
              ) : null}
              <TouchableOpacity
                onPress={runEnrich}
                disabled={enriching}
                style={styles.enrichBtn}
                testID="review-enrich-btn"
              >
                {enriching ? <ActivityIndicator color={colors.accent} /> : (
                  <>
                    <Ionicons name="flash-outline" size={16} color={colors.accent} />
                    <Text style={{ color: colors.accent, fontWeight: "700", marginLeft: 4 }}>Enrich contact</Text>
                  </>
                )}
              </TouchableOpacity>
            </Card>

            {/* Fields */}
            {FIELDS.map((f) => (
              <View key={f.key} style={styles.field}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <View style={styles.fieldRow}>
                  <Ionicons name={f.icon} size={18} color={colors.textSecondary} />
                  <TextInput
                    value={String(values[f.key] || "")}
                    onChangeText={(v) => set(f.key, v)}
                    placeholder={f.placeholder}
                    placeholderTextColor={colors.textTertiary}
                    keyboardType={f.keyboard}
                    autoCapitalize={f.keyboard === "email-address" || f.keyboard === "url" ? "none" : "sentences"}
                    style={styles.fieldInput}
                    testID={`review-field-${f.key}`}
                  />
                </View>
              </View>
            ))}

            {err ? (
              <Text style={{ color: colors.danger, marginTop: spacing.sm }} testID="review-error">{err}</Text>
            ) : null}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Button
            title="Save contact"
            icon="checkmark"
            onPress={save}
            loading={saving}
            testID="review-save-btn"
          />
        </View>
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
  imageWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    aspectRatio: 1.586,
    backgroundColor: colors.surface,
    position: "relative",
  },
  image: { width: "100%", height: "100%" },
  confidenceBadge: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: "rgba(15,23,42,0.85)",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
    flexDirection: "row", alignItems: "center",
  },
  confidenceDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginRight: 6,
  },
  confidenceText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  enrichCard: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  aiBadge: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.sm,
  },
  aiBadgeText: {
    color: "#065F46", fontWeight: "700", fontSize: 10, marginLeft: 4,
  },
  enrichBtn: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#BBF7D0",
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    ...typography.caption,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  fieldInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
});
