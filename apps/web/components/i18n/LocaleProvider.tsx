"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translate } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/routing";

const LocaleContext = createContext<Locale>("ko");
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const locale = useContext(LocaleContext);
  const t = useMemo(() => (text: string) => translate(locale, text), [locale]);
  return { locale, t };
}
