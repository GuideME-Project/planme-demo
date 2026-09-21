import type { Metadata } from "next";
import { planmeOpenGraphImage } from "@/lib/brand-metadata";
import type { Locale } from "./routing";

// planme.kr currently redirects to this canonical host.
export const publicOrigin = "https://www.planme.kr";
export function localizedMetadata(locale: Locale, path: string, title: string): Metadata {
  const description = locale === "ko"
    ? "PlanME에서 나만의 여행 일정을 만들고, 항공·숙소·투어를 살펴보세요."
    : "Create your own travel itinerary with PlanME and explore flights, stays, and activities.";
  const url = `${publicOrigin}/${locale}${path}`;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: { ko: `${publicOrigin}/ko${path}`, en: `${publicOrigin}/en${path}`, "x-default": `${publicOrigin}/ko${path}` },
    },
    openGraph: {
      title: `PlanME · ${title}`,
      description,
      url,
      type: "website",
      locale: locale === "ko" ? "ko_KR" : "en_US",
      alternateLocale: locale === "ko" ? "en_US" : "ko_KR",
      images: [planmeOpenGraphImage],
    },
  };
}
export function homeMetadata(locale: Locale) {
  return localizedMetadata(locale, "", locale === "ko" ? "나만의 여행을 시작하세요" : "Start your own journey");
}
