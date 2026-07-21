import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, EmptyState } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type PreviewResp = {
  total: number; new: number; updated: number; failed: number; skipped: number;
  errors: string[];
  preview: any[];
};

/** Contacts data-management screen: Excel import + export. */
export default function DataScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [exporting, setExporting] = useState(false);
  const [downloadingTpl, setDownloadingTpl] = useState(false);
  const [importing, setImporting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [pendingB64, setPendingB64] = useState<string>("");
  const [plan, setPlan] = useState<string>("free");

  useEffect(() => {
    (async () => {
      try {
        const s = await api<{ plan: string }>("/billing/status");
        setPlan(s.plan);
      } catch {}
    })();
  }, []);

  const saveAndShare = async (filename: string, contentB64: string) => {
    try {
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, contentB64, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      } else {
        Alert.alert("Saved", `Saved to ${uri}`);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save file");
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const resp = await api<{ filename: string; content_b64: string; count: number }>("/contacts/export", {
        method: "POST",
        body: {},
      });
      await saveAndShare(resp.filename, resp.content_b64);
      Alert.alert("Export complete", `${resp.count} contacts exported.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) upgradePrompt();
      else Alert.alert("Export failed", (e as any)?.message || "Try again");
    } finally { setExporting(false); }
  };

  const downloadTemplate = async () => {
    setDownloadingTpl(true);
    try {
      const resp = await api<{ filename: string; content_b64: string }>("/contacts/import/template");
      await saveAndShare(resp.filename, resp.content_b64);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not download template");
    } finally { setDownloadingTpl(false); }
  };

  const pickAndPreview = async () => {
    setImporting(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      setPendingB64(b64);
      const resp = await api<PreviewResp>("/contacts/import/preview", { method: "POST", body: { content_b64: b64 }, timeoutMs: 60000 });
      setPreview(resp);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) upgradePrompt();
      else Alert.alert("Import failed", (e as any)?.message || "Could not read file");
    } finally { setImporting(false); }
  };

  const commit = async (duplicate_strategy: "merge" | "skip") => {
    if (!pendingB64) return;
    setCommitting(true);
    try {
      const resp = await api<{ imported: number; updated: number; failed: number; duplicate_removed: number; total: number }>(
        "/contacts/import/commit",
        { method: "POST", body: { content_b64: pendingB64, duplicate_strategy }, timeoutMs: 120000 }
      );
      setPreview(null);
      setPendingB64("");
      Alert.alert(
        "Import complete",
        `Total: ${resp.total}\nImported: ${resp.imported}\nUpdated: ${resp.updated}\nSkipped: ${resp.duplicate_removed}\nFailed: ${resp.failed}`,
        [{ text: "OK", onPress: () => router.replace("/(tabs)/contacts") }]
      );
    } catch (e: any) {
      Alert.alert("Import failed", e?.message || "Try again");
    } finally { setCommitting(false); }
  };

  const upgradePrompt = () => {
    Alert.alert(
      "Upgrade required",
      "Excel import and export are on the Basic plan and above.",
      [
        { text: "Later", style: "cancel" },
        { text: "See plans", onPress: () => router.push("/plans") },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="data-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="data-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Import / Export</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        {plan === "free" ? (
          <Card style={{ backgroundColor: "#FEF3C7", borderColor: "#FDE68A", marginBottom: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name="star-outline" size={18} color="#92400E" />
              <Text style={{ ...typography.bodyStrong, color: "#92400E", marginLeft: 8 }}>Basic feature</Text>
            </View>
            <Text style={{ ...typography.small, color: "#92400E", marginTop: 4 }}>
              Excel import & export unlock on the Basic plan (₹100/month).
            </Text>
            <View style={{ height: spacing.sm }} />
            <Button title="See plans" variant="secondary" onPress={() => router.push("/plans")} testID="data-upgrade-btn" />
          </Card>
        ) : null}

        <Card>
          <Text style={typography.bodyStrong}>Export contacts</Text>
          <Text style={[typography.small, { marginTop: 4 }]}>Download all your contacts as an Excel spreadsheet.</Text>
          <View style={{ height: spacing.md }} />
          <Button title="Export all contacts" icon="download-outline" onPress={doExport} loading={exporting} testID="data-export-btn" />
        </Card>

        <View style={{ height: spacing.md }} />

        <Card>
          <Text style={typography.bodyStrong}>Import contacts from Excel</Text>
          <Text style={[typography.small, { marginTop: 4 }]}>
            Start with our template. Duplicates (matched on email or phone) will be merged into existing contacts.
          </Text>
          <View style={{ height: spacing.md }} />
          <Button title="Download sample template" variant="secondary" icon="document-text-outline" onPress={downloadTemplate} loading={downloadingTpl} testID="data-template-btn" />
          <View style={{ height: spacing.sm }} />
          <Button title="Pick an Excel file…" icon="cloud-upload-outline" onPress={pickAndPreview} loading={importing} testID="data-import-btn" />
        </Card>
      </ScrollView>

      <Modal visible={!!preview} animationType="slide" transparent onRequestClose={() => setPreview(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="import-preview-sheet">
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={typography.h3}>Preview import</Text>
              <TouchableOpacity onPress={() => setPreview(null)} testID="import-close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 20 }}>
              {preview ? (
                <>
                  <View style={styles.summaryRow}>
                    <Stat label="Total" value={preview.total} />
                    <Stat label="New" value={preview.new} tone="success" />
                    <Stat label="Update" value={preview.updated} tone="info" />
                    <Stat label="Failed" value={preview.failed} tone={preview.failed ? "danger" : "muted"} />
                  </View>
                  {preview.errors.length > 0 ? (
                    <Card style={{ marginTop: spacing.md, backgroundColor: colors.dangerSoft, borderColor: "#FCA5A5" }}>
                      {preview.errors.map((err, i) => (
                        <Text key={i} style={[typography.small, { color: colors.danger }]}>• {err}</Text>
                      ))}
                    </Card>
                  ) : null}
                  <Text style={[typography.caption, { marginTop: spacing.md, marginBottom: 6 }]}>ROWS ({preview.preview.length})</Text>
                  {preview.preview.map((row, i) => (
                    <View key={i} style={[styles.previewRow, row._action === "failed" && { backgroundColor: colors.dangerSoft, borderColor: "#FCA5A5" }]} testID={`import-row-${i}`}>
                      <View style={styles.actionPill}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color:
                          row._action === "new" ? colors.accent : row._action === "update" ? colors.info : colors.danger,
                        }}>{row._action?.toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={typography.bodyStrong} numberOfLines={1}>{row.name || row.email || row.phone}</Text>
                        <Text style={typography.small} numberOfLines={1}>{row.company || row.email}</Text>
                        {row._error ? <Text style={{ ...typography.small, color: colors.danger }}>{row._error}</Text> : null}
                      </View>
                    </View>
                  ))}
                </>
              ) : null}
            </ScrollView>
            <View style={styles.sheetFooter}>
              <View style={{ flex: 1 }}>
                <Button title="Skip duplicates" variant="secondary" onPress={() => commit("skip")} loading={committing} testID="import-skip-btn" />
              </View>
              <View style={{ width: 8 }} />
              <View style={{ flex: 1 }}>
                <Button title="Merge & import" onPress={() => commit("merge")} loading={committing} icon="checkmark" testID="import-merge-btn" />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "info" | "danger" | "muted" }) {
  const color =
    tone === "success" ? colors.accent :
    tone === "info" ? colors.info :
    tone === "danger" ? colors.danger : colors.textPrimary;
  return (
    <View style={styles.stat}>
      <Text style={{ ...typography.caption, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: "700", color, marginTop: 4 }}>{value}</Text>
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: "88%", minHeight: "60%",
  },
  handle: {
    alignSelf: "center",
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 10,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetFooter: {
    flexDirection: "row",
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  summaryRow: { flexDirection: "row", gap: 8 },
  stat: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  previewRow: {
    flexDirection: "row", alignItems: "center",
    padding: 10,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: 6,
    backgroundColor: colors.surface,
  },
  actionPill: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
});
