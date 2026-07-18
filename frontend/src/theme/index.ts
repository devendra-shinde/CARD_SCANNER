/**
 * CardVault design tokens.
 * Import everywhere UI is drawn. Keep this the single source of truth for colors,
 * spacing, radii, and typography so screens stay consistent.
 */
export const colors = {
  bg: "#FFFFFF",
  surface: "#F8FAFC",
  surfaceElevated: "#FFFFFF",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  textTertiary: "#94A3B8",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  brand: "#0F172A",
  brandText: "#FFFFFF",
  accent: "#10B981",
  accentSoft: "#D1FAE5",
  warning: "#F59E0B",
  warningSoft: "#FEF3C7",
  danger: "#EF4444",
  dangerSoft: "#FEE2E2",
  info: "#3B82F6",
  infoSoft: "#DBEAFE",
  overlay: "rgba(15, 23, 42, 0.55)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const typography = {
  h1: { fontSize: 32, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.5, color: colors.textPrimary },
  h2: { fontSize: 24, lineHeight: 32, fontWeight: "700" as const, color: colors.textPrimary },
  h3: { fontSize: 20, lineHeight: 28, fontWeight: "700" as const, color: colors.textPrimary },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const, color: colors.textPrimary },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: "600" as const, color: colors.textPrimary },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const, color: colors.textSecondary },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 1, color: colors.textSecondary },
};
