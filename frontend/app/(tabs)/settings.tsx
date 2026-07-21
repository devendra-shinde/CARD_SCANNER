import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Card, Screen } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { useT } from "@/src/i18n";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const t = useT();

  const items: { icon: any; label: string; onPress: () => void; testID: string }[] = [
    { icon: "star-outline", label: "Plans & billing", onPress: () => router.push("/plans"), testID: "settings-plans" },
    { icon: "mail-outline", label: t("settings_email"), onPress: () => router.push("/settings/email"), testID: "settings-email" },
    { icon: "document-text-outline", label: t("settings_templates"), onPress: () => router.push("/settings/templates"), testID: "settings-templates" },
    { icon: "cloud-upload-outline", label: "Import / Export (Excel)", onPress: () => router.push("/data"), testID: "settings-data" },
    { icon: "logo-whatsapp", label: "WhatsApp campaign", onPress: () => router.push("/whatsapp"), testID: "settings-whatsapp" },
    { icon: "copy-outline", label: t("settings_duplicates"), onPress: () => router.push("/settings/duplicates"), testID: "settings-duplicates" },
    { icon: "bar-chart-outline", label: t("settings_analytics"), onPress: () => router.push("/analytics"), testID: "settings-analytics" },
    { icon: "language-outline", label: t("settings_language"), onPress: () => router.push("/settings/language"), testID: "settings-language" },
    { icon: "information-circle-outline", label: t("settings_about"), onPress: () => router.push("/settings/about"), testID: "settings-about" },
  ];

  return (
    <Screen scroll edges={["top"]} testID="settings-screen">
      <View style={styles.header}>
        <Text style={typography.h2}>{t("settings_title")}</Text>
      </View>

      <Card style={styles.profileCard} testID="settings-profile-card">
        <View style={styles.avatar}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 22 }}>
            {(user?.name || "?").split(" ").slice(0, 2).map(s => s[0]?.toUpperCase()).join("")}
          </Text>
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={typography.bodyStrong}>{user?.name}</Text>
          <Text style={typography.small} numberOfLines={1}>{user?.email}</Text>
          {user?.organization ? <Text style={[typography.small, { marginTop: 2 }]}>{user.organization}</Text> : null}
        </View>
      </Card>

      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
        {items.map((it) => (
          <TouchableOpacity
            key={it.testID}
            style={styles.row}
            onPress={it.onPress}
            activeOpacity={0.85}
            testID={it.testID}
          >
            <View style={styles.rowIcon}>
              <Ionicons name={it.icon} size={20} color={colors.textPrimary} />
            </View>
            <Text style={[typography.body, { flex: 1 }]}>{it.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}

        <TouchableOpacity onPress={logout} style={styles.logoutBtn} testID="settings-logout-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "700", marginLeft: 8 }}>{t("sign_out")}</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  profileCard: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: spacing.lg,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
    marginRight: spacing.md,
  },
  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginTop: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
});
