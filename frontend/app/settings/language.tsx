import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Screen } from "@/src/components/ui";
import { LANGUAGES, useI18n, type LangCode } from "@/src/i18n";
import { colors, radius, spacing, typography } from "@/src/theme";

/**
 * First-run language picker AND settings language editor.
 *
 * Behaviour:
 * - If accessed on first launch (onboarded === false), Continue marks
 *   onboarded and returns to root.
 * - If accessed from Settings, back button/Continue both return to Settings.
 */
export default function LanguageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lang, setLang, t, onboarded, markOnboarded } = useI18n();

  const pick = async (code: LangCode) => {
    await setLang(code);
  };

  const done = async () => {
    if (!onboarded) {
      await markOnboarded();
      router.replace("/");
    } else {
      router.back();
    }
  };

  return (
    <Screen edges={["top", "bottom"]} testID="language-screen">
      <View style={styles.header}>
        {onboarded ? (
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="lang-back-btn">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
        <Text style={typography.bodyStrong}>{t("settings_language")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
        <Text style={typography.h1}>{t("lang_title")}</Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {t("lang_sub")}
        </Text>
      </View>

      <FlatList
        data={LANGUAGES}
        keyExtractor={(item) => item.code}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
        renderItem={({ item }) => {
          const active = lang === item.code;
          return (
            <TouchableOpacity
              onPress={() => pick(item.code)}
              activeOpacity={0.85}
              style={[styles.row, active && styles.rowActive]}
              testID={`lang-option-${item.code}`}
            >
              <Text style={styles.flag}>{item.flag}</Text>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.native}>{item.native}</Text>
                <Text style={styles.label}>{item.label}</Text>
              </View>
              {active ? (
                <View style={styles.check}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </View>
              ) : (
                <View style={styles.checkEmpty} />
              )}
            </TouchableOpacity>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button title={t("lang_continue")} onPress={done} testID="lang-continue-btn" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  row: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    marginBottom: 10,
  },
  rowActive: { borderColor: colors.brand, backgroundColor: colors.surface },
  flag: { fontSize: 26 },
  native: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  label: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  check: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  checkEmpty: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1.5, borderColor: colors.border,
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
});
