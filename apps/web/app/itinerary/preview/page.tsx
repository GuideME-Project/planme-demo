import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItineraryDashboard } from "@/components/itinerary/ItineraryDashboard";
import {
  decodePlanmePreviewPayload,
  PLANME_PREVIEW_DATA_PARAM,
  type PlanmeItinerary,
} from "@planme/core";

type PreviewPageSearchParams = {
  data?: string | string[];
};

type ItineraryPreviewPageProps = {
  searchParams: Promise<PreviewPageSearchParams>;
};

/**
 * Builds metadata from the encoded PlanME preview payload.
 */
export async function generateMetadata({
  searchParams,
}: ItineraryPreviewPageProps): Promise<Metadata> {
  const itinerary = await readPreviewItinerary(searchParams);

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
 * Renders a stateless PlanME draft preview page from a URL payload.
 */
export default async function ItineraryPreviewPage({
  searchParams,
}: ItineraryPreviewPageProps) {
  const itinerary = await readPreviewItinerary(searchParams);

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

/**
 * Reads and validates the preview itinerary from the Next.js search params object.
 */
async function readPreviewItinerary(
  searchParams: Promise<PreviewPageSearchParams>,
): Promise<PlanmeItinerary | null> {
  const params = await searchParams;
  const rawPayload = params[PLANME_PREVIEW_DATA_PARAM];
  const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;

  if (!payload) {
    return null;
  }

  return decodePlanmePreviewPayload(payload);
}
