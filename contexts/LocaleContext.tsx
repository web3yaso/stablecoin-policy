"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

export type Locale = "zh" | "en";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
});

const LOCALE_STORAGE_KEY = "sc-locale";
const DEFAULT_LOCALE: Locale = "en";

function readLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "en" || stored === "zh" ? stored : DEFAULT_LOCALE;
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  function onStorage(e: StorageEvent) {
    if (e.key === LOCALE_STORAGE_KEY) onStoreChange();
  }

  function onLocaleChange() {
    onStoreChange();
  }

  window.addEventListener("storage", onStorage);
  window.addEventListener("sc-locale-change", onLocaleChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("sc-locale-change", onLocaleChange);
  };
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, () => DEFAULT_LOCALE);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = (l: Locale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
    window.dispatchEvent(new Event("sc-locale-change"));
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
