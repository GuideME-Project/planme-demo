import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { PlanmeSearchHome } from "@/components/planme-search/PlanmeSearchHome";
import { PlanmeHome } from "@/components/home/PlanmeHome";
import { MagazineProvider } from "@/components/home/MagazineContext";

import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/routing";
import { homeMetadata } from "@/lib/i18n/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return homeMetadata(locale);
}

type HomeProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function Home({ searchParams, params: routeParams }: HomeProps) {
  const { locale } = await routeParams;
  if (!isLocale(locale)) notFound();
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <MagazineProvider><PlanmeHome>
      <PlanmeSearchHome
        initialDestination={query?.trim().slice(0, 100) ?? ""}
        initialSubmissionId={randomUUID()}
      />
    </PlanmeHome></MagazineProvider>
  );
}
