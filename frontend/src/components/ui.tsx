/**
 * Reusable primitives (button, card, chip, input, screen wrapper, empty state, toast).
 * Keeps screens clean and design consistent.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, typography } from "@/src/theme";

export function Screen({
  children,
  style,
  edges = ["top"],
  scroll = false,
  testID,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  edges?: ("top" | "bottom" | "left" | "right")[];
  scroll?: boolean;
  testID?: string;
}) {
  const Wrapper = scroll ? ScrollView : View;
  const wrapperProps: any = scroll
    ? { contentContainerStyle: [{ paddingBottom: spacing.xl }, style], showsVerticalScrollIndicator: false }
    : { style: [{ flex: 1 }, style] };
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }} testID={testID}>
      <Wrapper {...wrapperProps}>{children}</Wrapper>
    </SafeAreaView>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const styles = buttonStyles(variant, isDisabled);
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [styles.base, pressed && !isDisabled && { opacity: 0.85 }, style]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={styles.text.color as string} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={styles.text.color as string} style={{ marginRight: 8 }} /> : null}
          <Text style={styles.text}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

function buttonStyles(variant: string, disabled: boolean) {
  const base: ViewStyle = {
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
  };
  const map: any = {
    primary: {
      base: { ...base, backgroundColor: disabled ? "#CBD5E1" : colors.brand },
      text: { color: colors.brandText, fontWeight: "700", fontSize: 16 },
    },
    secondary: {
      base: { ...base, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
      text: { color: colors.textPrimary, fontWeight: "600", fontSize: 16 },
    },
    ghost: {
      base: { ...base, backgroundColor: "transparent" },
      text: { color: colors.textPrimary, fontWeight: "600", fontSize: 16 },
    },
    danger: {
      base: { ...base, backgroundColor: colors.danger },
      text: { color: "#fff", fontWeight: "700", fontSize: 16 },
    },
  };
  return map[variant] || map.primary;
}

export function Input({
  label,
  error,
  right,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; error?: string; right?: React.ReactNode; containerStyle?: ViewStyle }) {
  return (
    <View style={[{ marginBottom: spacing.md }, containerStyle]}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={[styles.inputWrapper, error ? { borderColor: colors.danger } : null]}>
        <TextInput
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          {...props}
        />
        {right}
      </View>
      {error ? <Text style={styles.inputError}>{error}</Text> : null}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onPress?: () => void;
  testID?: string;
}) {
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.card, style]} testID={testID}>
        {children}
      </TouchableOpacity>
    );
  }
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.chip, active && styles.chipActive]}
      testID={testID}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function EmptyState({
  icon = "documents-outline",
  title,
  subtitle,
  action,
  testID,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void; testID?: string };
  testID?: string;
}) {
  return (
    <View style={styles.emptyWrap} testID={testID}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={40} color={colors.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {action ? (
        <View style={{ marginTop: spacing.md, width: "100%" }}>
          <Button title={action.label} onPress={action.onPress} testID={action.testID} />
        </View>
      ) : null}
    </View>
  );
}

export function SectionHeader({ title, action, testID }: { title: string; action?: { label: string; onPress: () => void; testID?: string }; testID?: string }) {
  return (
    <View style={styles.sectionHeader} testID={testID}>
      <Text style={typography.h3}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={action.onPress} testID={action.testID}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function Avatar({ name, size = 44, color }: { name: string; size?: number; color?: string }) {
  const initials = getInitials(name);
  const bg = color || pickColor(name);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>{initials}</Text>
    </View>
  );
}

export function getInitials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

const AVATAR_COLORS = ["#0F172A", "#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6"];
export function pickColor(seed?: string) {
  if (!seed) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function useHeaderPad() {
  const insets = useSafeAreaInsets();
  return insets.top;
}

const styles = StyleSheet.create({
  inputLabel: {
    ...typography.caption,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  inputError: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 14,
  },
  chipTextActive: {
    color: colors.brandText,
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h3,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  emptySub: {
    ...typography.small,
    textAlign: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
});
