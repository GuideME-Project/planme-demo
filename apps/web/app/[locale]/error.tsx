"use client";
import { useLocale } from "@/components/i18n/LocaleProvider";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useLocale();
  return <main className="p-8"><h1>{t("화면을 불러오지 못했습니다.")}</h1><button onClick={reset}>{t("다시 시도")}</button></main>;
}
