import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, EmptyState } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

type Analytics = {
  contacts_total: number;
  scans_this_month: number;
  campaigns_total: number;
  emails_sent: number;
  industries: { label: string; count: number }[];
  countries: { label: string; count: number }[];
  growth: { date: string; count: number }[];
};

const PIE_COLORS = ["#0F172A", "#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6"];

export default function AnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [a, setA] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<Analytics>("/analytics");
      setA(data);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="analytics-screen">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="analytics-back-btn">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={typography.bodyStrong}>Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !a ? (
        <View style={{ padding: spacing.xl, alignItems: "center" }}><ActivityIndicator /></View>
      ) : a.contacts_total === 0 ? (
        <EmptyState
          icon="bar-chart-outline"
          title="No data yet"
          subtitle="Add some contacts to see analytics."
          testID="analytics-empty"
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
          {/* Stats grid */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }}>
            <StatBox label="Total contacts" value={a.contacts_total} />
            <StatBox label="Scans this month" value={a.scans_this_month} accent />
            <StatBox label="Campaigns" value={a.campaigns_total} />
            <StatBox label="Emails sent" value={a.emails_sent} />
          </View>

          {/* Growth line chart */}
          <Card style={{ marginTop: spacing.md }} testID="analytics-growth-card">
            <Text style={typography.caption}>CONTACT GROWTH · 30 DAYS</Text>
            <View style={{ marginTop: spacing.sm }}>
              <GrowthChart data={a.growth} />
            </View>
          </Card>

          {/* Industry pie */}
          <Card style={{ marginTop: spacing.md }} testID="analytics-industries-card">
            <Text style={typography.caption}>INDUSTRIES</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
              <PieChart data={a.industries} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                {a.industries.slice(0, 6).map((item, i) => (
                  <LegendRow key={item.label} label={item.label} count={item.count} color={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </View>
            </View>
          </Card>

          {/* Country pie */}
          {a.countries.length > 0 && (
            <Card style={{ marginTop: spacing.md }} testID="analytics-countries-card">
              <Text style={typography.caption}>COUNTRIES</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
                <PieChart data={a.countries} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  {a.countries.slice(0, 6).map((item, i) => (
                    <LegendRow key={item.label} label={item.label} count={item.count} color={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </View>
              </View>
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function StatBox({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <View style={{ width: "50%", padding: 4 }}>
      <View style={[{
        borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
        backgroundColor: accent ? colors.brand : colors.surfaceElevated,
        padding: spacing.md,
      }]}>
        <Text style={[typography.caption, accent && { color: "rgba(255,255,255,0.7)" }]}>{label}</Text>
        <Text style={{ fontSize: 26, fontWeight: "700", color: accent ? "#fff" : colors.textPrimary, marginTop: 6 }}>
          {value.toLocaleString()}
        </Text>
      </View>
    </View>
  );
}

function LegendRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 8 }} />
      <Text style={[typography.small, { flex: 1, color: colors.textPrimary }]} numberOfLines={1}>{label}</Text>
      <Text style={typography.bodyStrong}>{count}</Text>
    </View>
  );
}

function PieChart({ data }: { data: { label: string; count: number }[] }) {
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  let start = -Math.PI / 2;
  const paths: { d: string; color: string }[] = [];
  data.forEach((d, i) => {
    const angle = (d.count / total) * Math.PI * 2;
    const end = start + angle;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    paths.push({ d: path, color: PIE_COLORS[i % PIE_COLORS.length] });
    start = end;
  });
  return (
    <Svg width={size} height={size}>
      {paths.map((p, i) => <Path key={i} d={p.d} fill={p.color} />)}
      <Circle cx={cx} cy={cy} r={r * 0.42} fill={colors.surfaceElevated} />
    </Svg>
  );
}

function GrowthChart({ data }: { data: { date: string; count: number }[] }) {
  const W = 300;
  const H = 100;
  if (!data.length) return <Text style={typography.small}>No recent activity.</Text>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const barWidth = W / data.length - 2;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.count / max) * (H - 20);
        return (
          <Rect
            key={d.date}
            x={i * (W / data.length) + 1}
            y={H - h}
            width={barWidth}
            height={h}
            rx={2}
            fill={colors.brand}
            opacity={0.8}
          />
        );
      })}
    </Svg>
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
