"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "./LocaleProvider";
import { localizedPath } from "@/lib/i18n/routing";

// Remember an explicit language choice for one year; an explicit URL always takes precedence.
const localePreferenceMaxAgeSeconds = 365 * 24 * 60 * 60;

export function LanguageSwitcher() {
  const { locale, t } = useLocale();
  const [notice, setNotice] = useState(false);
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return (
    <div className="language-switcher" role="group" aria-label={t("언어 선택")}>
      {(["ko", "en"] as const).map((language) => (
        <Link
          key={language}
          href={localizedPath(pathname, language) + (query ? `?${query}` : "")}
          lang={language}
          hrefLang={language}
          aria-current={locale === language ? "page" : undefined}
          onClick={(event) => {
            if (locale === language) { event.preventDefault(); return; }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const save = new Event("planme:before-language-change", { cancelable: true });
            if (!window.dispatchEvent(save)) { setNotice(true); return; }
            document.cookie = `planme-locale=${language}; Path=/; Max-Age=${localePreferenceMaxAgeSeconds}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
            // A full navigation also restores form state consistently across root-layout changes.
            window.location.assign(localizedPath(pathname, language) + window.location.search + window.location.hash);
          }}
        >{language === "ko" ? "한국어" : "English"}</Link>
      ))}
      {notice && <span role="status" style={{ fontSize: 12, flexBasis: "100%" }}>{t("검색 상태를 보존할 수 없어 언어를 전환하지 못했습니다. 요청 완료 후 다시 시도해 주세요.")}</span>}
    </div>
  );
}
