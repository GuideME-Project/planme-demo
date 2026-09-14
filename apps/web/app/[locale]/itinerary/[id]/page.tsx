import { notFound } from "next/navigation";
import DetailPage, { generateMetadata as detailMetadata } from "@/app/itinerary/[id]/page";
import { isLocale } from "@/lib/i18n/routing";
import { localizedMetadata } from "@/lib/i18n/metadata";

type Props = { params: Promise<{ locale: string; id: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const original = await detailMetadata({ params: Promise.resolve({ id }) });
  return localizedMetadata(locale, `/itinerary/${encodeURIComponent(id)}`, locale === "en" ? "Your travel itinerary" : String(original.title ?? "여행 일정"));
}
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  return <DetailPage params={Promise.resolve({ id })} />;
}
