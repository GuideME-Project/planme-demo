import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItineraryDashboard } from "@/components/itinerary/ItineraryDashboard";
import { findPlanmeItineraryForDetailPage } from "@/lib/preview-itinerary-store";

type ItineraryPageProps = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * Builds OpenGraph metadata for a PlanME itinerary detail page.
 */
export async function generateMetadata({
  params,
}: ItineraryPageProps): Promise<Metadata> {
  const { id } = await params;
  const itinerary = await findPlanmeItineraryForDetailPage(id);

  if (!itinerary) {
    return {
      title: "PlanME 일정 없음",
    };
  }

  return {
    title: itinerary.title,
    description: itinerary.summary,
    openGraph: {
      title: itinerary.title,
      description: itinerary.summary,
      images: [`/og?title=${encodeURIComponent(itinerary.title)}`],
    },
  };
}

/**
 * Renders a public PlanME itinerary detail page for ChatGPT link handoff.
 */
export default async function ItineraryPage({ params }: ItineraryPageProps) {
  const { id } = await params;
  const itinerary = await findPlanmeItineraryForDetailPage(id);

  if (!itinerary) {
    notFound();
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-[1920px] px-5 py-6 lg:px-8">
        <ItineraryDashboard itinerary={itinerary} compact />
      </div>
    </main>
  );
}
