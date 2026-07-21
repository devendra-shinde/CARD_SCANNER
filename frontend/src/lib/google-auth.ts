/**
 * Emergent-managed Google Sign-In hook.
 *
 * Flow per the playbook:
 *   1. Build a platform-specific redirect URL.
 *   2. Open https://auth.emergentagent.com/?redirect=<encoded redirect>.
 *   3. On mobile — wait for openAuthSessionAsync to return, parse session_id
 *      from result.url (hash or query).
 *      On web — full page redirect; the RouterGate parses window.location on mount.
 *   4. POST /api/auth/google-session with the session_id — backend verifies
 *      with Emergent, upserts the user, returns our own JWT.
 */
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

import { setToken, api } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

const AUTH_URL = "https://auth.emergentagent.com/";
const USER_KEY = "cardvault_user";

function extractSessionId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const idx = rawUrl.indexOf("session_id=");
  if (idx < 0) return null;
  const tail = rawUrl.slice(idx + "session_id=".length);
  return tail.split(/[&#?]/)[0] || null;
}

export function useGoogleAuth() {
  const [loading, setLoading] = useState(false);

  const signInWithGoogle = useCallback(async (): Promise<{ ok: true } | { ok: false; error?: string }> => {
    try {
      setLoading(true);
      const redirectUrl =
        Platform.OS === "web"
          ? window.location.origin + "/"
          : Linking.createURL("");
      const authUrl = `${AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === "web") {
        window.location.href = authUrl;
        return { ok: true }; // page navigates away
      }

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type !== "success") {
        return { ok: false, error: "cancelled" };
      }
      const sessionId = extractSessionId(result.url);
      if (!sessionId) return { ok: false, error: "No session_id in redirect" };
      const resp = await api<{ access_token: string; user: any }>("/auth/google-session", {
        method: "POST",
        auth: false,
        body: { session_id: sessionId },
      });
      await setToken(resp.access_token);
      await storage.setItem(USER_KEY, resp.user);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Google sign-in failed" };
    } finally {
      setLoading(false);
    }
  }, []);

  return { signInWithGoogle, loading };
}

/**
 * Web only: called from the root layout on mount to consume a `?session_id=` or
 * `#session_id=` fragment left by Emergent after the redirect. Returns true if
 * a session was consumed (caller should refresh auth state).
 */
export async function consumePendingWebSession(): Promise<boolean> {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const search = window.location.search || "";
  const hash = window.location.hash || "";
  const sessionId = extractSessionId(search) || extractSessionId(hash);
  if (!sessionId) return false;
  try {
    const resp = await api<{ access_token: string; user: any }>("/auth/google-session", {
      method: "POST",
      auth: false,
      body: { session_id: sessionId },
    });
    await setToken(resp.access_token);
    await storage.setItem(USER_KEY, resp.user);
    // Clean the URL so a refresh doesn't reprocess it
    try { window.history.replaceState(null, "", window.location.pathname); } catch {}
    return true;
  } catch {
    try { window.history.replaceState(null, "", window.location.pathname); } catch {}
    return false;
  }
}
