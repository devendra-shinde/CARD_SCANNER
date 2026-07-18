/**
 * Runtime for i18n: language state, `t()` translator, hook + provider.
 *
 * Loads all bundles at module time (they're small, ~15KB each) so language
 * switch is instant with no network round-trip. Falls back to English when a
 * key is missing in the selected language.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { storage } from "@/src/utils/storage";

import { en, LANGUAGES, type LangCode, type TranslationKey } from "./strings.en";
import hi from "./strings.hi";
import mr from "./strings.mr";
import gu from "./strings.gu";
import ta from "./strings.ta";
import te from "./strings.te";
import kn from "./strings.kn";
import ml from "./strings.ml";
import bn from "./strings.bn";
import pa from "./strings.pa";
import or from "./strings.or";

export { LANGUAGES, type LangCode, type TranslationKey };

const BUNDLES: Record<LangCode, Partial<Record<TranslationKey, string>>> = {
  en, hi, mr, gu, ta, te, kn, ml, bn, pa, or,
};

const STORAGE_KEY = "cardvault_lang";
const ONBOARDED_KEY = "cardvault_lang_onboarded";

type Ctx = {
  lang: LangCode;
  setLang: (l: LangCode) => Promise<void>;
  t: (key: TranslationKey) => string;
  onboarded: boolean;
  markOnboarded: () => Promise<void>;
  ready: boolean;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>("en");
  const [onboarded, setOnboarded] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<LangCode>(STORAGE_KEY, "en" as LangCode);
      const done = await storage.getItem<boolean>(ONBOARDED_KEY, false);
      if (stored && BUNDLES[stored]) setLangState(stored);
      setOnboarded(!!done);
      setReady(true);
    })();
  }, []);

  const setLang = useCallback(async (l: LangCode) => {
    setLangState(l);
    await storage.setItem(STORAGE_KEY, l);
  }, []);

  const markOnboarded = useCallback(async () => {
    setOnboarded(true);
    await storage.setItem(ONBOARDED_KEY, true);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      const bundle = BUNDLES[lang] || en;
      return (bundle[key] as string) ?? (en[key] as string) ?? String(key);
    },
    [lang]
  );

  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t, onboarded, markOnboarded, ready }),
    [lang, setLang, t, onboarded, markOnboarded, ready]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Convenience: `const t = useT();` in components. */
export function useT() {
  return useI18n().t;
}
