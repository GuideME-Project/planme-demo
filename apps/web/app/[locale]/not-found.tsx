"use client";
import Link from "next/link";
import { useLocale } from "@/components/i18n/LocaleProvider";
export default function NotFound() {
  const { locale, t } = useLocale();
  return <main className="p-8"><h1>{t("페이지를 찾을 수 없습니다.")}</h1><Link href={`/${locale}`}>{t("홈으로 돌아가기")}</Link></main>;
}
