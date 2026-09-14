export const locales = ["ko", "en"] as const;
export type Locale = (typeof locales)[number];
export function isLocale(value: string): value is Locale {
  return value === "ko" || value === "en";
}
export function localizedPath(path: string, locale: Locale) {
  const pathname = path.replace(/^\/(ko|en)(?=\/|$)/, "");
  return `/${locale}${pathname === "/" ? "" : pathname}`;
}
