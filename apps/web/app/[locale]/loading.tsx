"use client";
import { useLocale } from "@/components/i18n/LocaleProvider";
export default function Loading() {
  const { t } = useLocale();
  return <p className="p-8" role="status">{t("불러오는 중입니다.")}</p>;
}
