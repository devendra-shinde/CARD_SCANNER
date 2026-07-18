import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/src/components/ui";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function About() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="about-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="about-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>About CardVault</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ padding: spacing.lg }}>
        <View style={styles.logoWrap}>
          <View style={styles.logo}><Ionicons name="scan" size={28} color="#fff" /></View>
          <Text style={typography.h2}>CardVault</Text>
          <Text style={typography.small}>Every card, forever organized.</Text>
        </View>
        <Card>
          <Text style={typography.caption}>VERSION</Text>
          <Text style={typography.body}>1.0.0</Text>
        </Card>
        <View style={{ height: spacing.sm }} />
        <Card>
          <Text style={typography.small}>
            CardVault turns paper cards into a paperless smart CRM: scan, enrich, organize, and reach out — all in one place.
          </Text>
        </Card>
      </View>
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
  logoWrap: { alignItems: "center", marginBottom: spacing.lg },
  logo: {
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
});
