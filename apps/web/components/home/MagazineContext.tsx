"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const MagazineContext = createContext<{
  countryCode: string | null;
  setCountryCode: (countryCode: string | null) => void;
}>({ countryCode: null, setCountryCode: () => {} });

export function MagazineProvider({ children }: { children: ReactNode }) {
  const [countryCode, setCountryCode] = useState<string | null>(null);
  return <MagazineContext.Provider value={{ countryCode, setCountryCode }}>{children}</MagazineContext.Provider>;
}

export function useMagazineCountry() { return useContext(MagazineContext); }
