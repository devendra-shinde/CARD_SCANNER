/**
 * Auth context — session state + login/signup/verifyOtp/logout.
 * Keeps token in SecureStore and user profile in memory + AsyncStorage.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, clearToken, setToken } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  organization?: string;
  role?: string;
  email_verified: boolean;
  created_at: string;
};

type Ctx = {
  user: AuthUser | null;
  loading: boolean;
  signup: (p: { name: string; email: string; password: string; organization?: string; role?: string }) => Promise<void>;
  verifyOtp: (email: string, otp: string) => Promise<void>;
  resendOtp: (email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (email: string, otp: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);
const USER_KEY = "cardvault_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<AuthUser>("/auth/me");
      setUser(me);
      await storage.setItem(USER_KEY, me);
    } catch {
      setUser(null);
      await clearToken();
      await storage.removeItem(USER_KEY);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cached = await storage.getItem<AuthUser>(USER_KEY, null as any);
      if (cached) setUser(cached as AuthUser);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signup = useCallback(async (p: { name: string; email: string; password: string; organization?: string; role?: string }) => {
    const resp = await api<{ dev_otp?: string }>("/auth/signup", { method: "POST", body: p, auth: false });
    return { dev_otp: resp?.dev_otp };
  }, []);

  const verifyOtp = useCallback(async (email: string, otp: string) => {
    const resp = await api<{ access_token: string; user: AuthUser }>("/auth/verify-otp", {
      method: "POST",
      body: { email, otp },
      auth: false,
    });
    await setToken(resp.access_token);
    setUser(resp.user);
    await storage.setItem(USER_KEY, resp.user);
  }, []);

  const resendOtp = useCallback(async (email: string) => {
    const resp = await api<{ dev_otp?: string }>("/auth/resend-otp", { method: "POST", body: { email }, auth: false });
    return { dev_otp: resp?.dev_otp };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const resp = await api<{ access_token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await setToken(resp.access_token);
    setUser(resp.user);
    await storage.setItem(USER_KEY, resp.user);
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    const resp = await api<{ dev_otp?: string }>("/auth/forgot-password", { method: "POST", body: { email }, auth: false });
    return { dev_otp: resp?.dev_otp };
  }, []);

  const resetPassword = useCallback(async (email: string, otp: string, new_password: string) => {
    await api("/auth/reset-password", { method: "POST", body: { email, otp, new_password }, auth: false });
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    await storage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ user, loading, signup, verifyOtp, resendOtp, login, forgotPassword, resetPassword, logout, refresh }),
    [user, loading, signup, verifyOtp, resendOtp, login, forgotPassword, resetPassword, logout, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
