import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { colors, radius, spacing, typography } from "@/src/theme";

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);

  const laserY = useSharedValue(0);

  const laserStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: laserY.value }],
  }));

  // Start looping laser once
  if (laserY.value === 0) {
    laserY.value = withRepeat(withTiming(180, { duration: 1600 }), -1, true);
  }

  const compressAndSend = async (uri: string) => {
    setBusy(true);
    setError(null);
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!compressed.base64) throw new Error("Could not read image");
      const data = await api<any>("/ocr/scan", {
        method: "POST",
        body: { image_b64: compressed.base64 },
        timeoutMs: 60000,
      });
      router.replace({
        pathname: "/scan-review",
        params: { data: JSON.stringify(data), image: `data:image/jpeg;base64,${compressed.base64}` },
      });
    } catch (e: any) {
      const msg =
        e?.message ||
        "We couldn't read this card. Try a clearer, well-lit photo — or add the contact manually.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: false });
      if (photo?.uri) await compressAndSend(photo.uri);
    } catch (e: any) {
      setError(e?.message || "Capture failed");
    }
  };

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo library access denied");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, base64: false });
    if (!res.canceled && res.assets?.[0]?.uri) await compressAndSend(res.assets[0].uri);
  };

  // Permissions gate
  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: "#000" }]} testID="scan-loading">
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: "#000", padding: spacing.lg }]} testID="scan-permission-screen">
        <Ionicons name="camera-outline" size={64} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700", marginTop: spacing.md, textAlign: "center" }}>
          Camera access needed
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: spacing.sm }}>
          To scan business cards, allow CardVault to use your camera.
        </Text>
        <View style={{ height: spacing.lg }} />
        {permission.canAskAgain ? (
          <Button title="Grant permission" onPress={requestPermission} testID="scan-permission-grant-btn" />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} testID="scan-permission-settings-btn" />
        )}
        <View style={{ height: spacing.sm }} />
        <Button title="Import from gallery instead" variant="ghost" onPress={pickFromGallery} testID="scan-permission-gallery-btn" />
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: spacing.md }} testID="scan-permission-close-btn">
          <Text style={{ color: "rgba(255,255,255,0.8)" }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }} testID="scan-screen">
      <CameraView ref={(r) => { cameraRef.current = r; }} style={StyleSheet.absoluteFill} facing="back" />

      {/* Overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ flex: 1 }} />
        <View style={styles.cardFrame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <Animated.View style={[styles.laser, laserStyle]} />
        </View>
        <View style={{ flex: 1 }} />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="scan-close-btn">
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={{ color: "#fff", fontWeight: "700" }}>Align card in frame</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity onPress={pickFromGallery} style={styles.sideBtn} testID="scan-gallery-btn">
          <Ionicons name="images-outline" size={22} color="#fff" />
          <Text style={styles.sideLabel}>Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={capture}
          style={[styles.shutter, busy && { opacity: 0.5 }]}
          disabled={busy}
          testID="scan-capture-btn"
        >
          {busy ? <ActivityIndicator color={colors.brand} /> : <View style={styles.shutterInner} />}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/contact/new")} style={styles.sideBtn} testID="scan-manual-btn">
          <Ionicons name="create-outline" size={22} color="#fff" />
          <Text style={styles.sideLabel}>Manual</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBanner} testID="scan-error-banner">
          <Text style={{ color: "#fff", fontWeight: "600", marginBottom: 6 }}>{error}</Text>
          <TouchableOpacity
            onPress={() => router.replace("/contact/new")}
            style={styles.errorCta}
            testID="scan-error-manual-btn"
          >
            <Ionicons name="create-outline" size={14} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", marginLeft: 4 }}>Add manually</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <View style={styles.busyCard}>
            <ActivityIndicator color={colors.brand} />
            <Text style={{ ...typography.bodyStrong, marginTop: spacing.sm }}>Reading your card…</Text>
            <Text style={typography.small}>OCR + AI parsing</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const CARD_ASPECT = 1.586;
const CARD_WIDTH = 300;
const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_ASPECT);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
  },
  cardFrame: {
    alignSelf: "center",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  corner: {
    position: "absolute",
    width: 24, height: 24,
    borderColor: colors.accent, borderWidth: 3,
  },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  laser: {
    position: "absolute",
    left: 8, right: 8, top: 0,
    height: 2,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.8, shadowRadius: 8,
    borderRadius: 2,
  },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sideBtn: { alignItems: "center", width: 64 },
  sideLabel: { color: "#fff", fontSize: 11, marginTop: 4, fontWeight: "600" },
  shutter: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: "rgba(255,255,255,0.4)",
  },
  shutterInner: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brand,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  busyCard: {
    backgroundColor: colors.bg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    alignItems: "center",
    minWidth: 220,
  },
  errorBanner: {
    position: "absolute", left: spacing.lg, right: spacing.lg, top: 80,
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md,
  },
  errorCta: {
    alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
  },
});
