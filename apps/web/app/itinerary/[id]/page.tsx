import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItineraryDashboard } from "@/components/itinerary/ItineraryDashboard";
import { PlanmeGenerationProgress } from "@/components/planme-search/PlanmeGenerationProgress";
import { createV3DashboardItinerary } from "@planme/core";
import { isPlanmeProgressPreviewEnabled } from "@/lib/planme-progress-preview";
import { createRouteFinalizationToken } from "@/lib/route-finalization-token";
import { getPlanmeV3Storage } from "@/lib/planme-v3/runtime";
import {
  findPlanmeItineraryForDetailPage,
  getPreviewItineraryRecordById,
} from "@/lib/preview-itinerary-store";

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

  if (id.startsWith("planme-v3-")) {
    const snapshot = await getPlanmeV3Storage().jobStore.getJob(id);
    if (!snapshot) {
      return { title: "PlanME 일정 없음" };
    }
    const title = snapshot.activeRevision?.intent.destination
      ? `${snapshot.activeRevision.intent.destination} 여행 일정`
      : "PlanME 일정 생성 중";
    const description = "추천 장소와 이동 경로가 포함된 PlanME 여행 일정입니다.";
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [`/og?title=${encodeURIComponent(title)}`],
      },
    };
  }

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

  if (id.startsWith("planme-v3-")) {
    const snapshot = await getPlanmeV3Storage().jobStore.getJob(id);
    if (!snapshot) {
      notFound();
    }
    const revision = snapshot.activeRevision;
    const pageOrigin = process.env.PLANME_WEB_ORIGIN?.trim() || "https://planme-demo.vercel.app";
    if (!revision) {
      if (isPlanmeProgressPreviewEnabled()) {
        return (
          <PlanmeGenerationProgress
            itineraryId={id}
            initialPhase={snapshot.meta.phase}
          />
        );
      }
      return (
        <main className="min-h-screen px-5 py-8 lg:px-8">
          <p>여행 일정을 준비하고 있습니다.</p>
        </main>
      );
    }
    const pageUrl = new URL(
      `/itinerary/${encodeURIComponent(id)}`,
      pageOrigin,
    ).toString();
    const itinerary = createV3DashboardItinerary(revision, pageUrl);
    if (!itinerary) {
      notFound();
    }

    return (
      <main className="min-h-screen">
        <div className="mx-auto w-full max-w-[1920px] px-5 py-6 lg:px-8">
          <ItineraryDashboard
            itinerary={itinerary}
            compact
            editingEnabled={false}
            routeFinalized
            routeRevision={revision.revision}
          />
        </div>
      </main>
    );
  }

  const record = await getPreviewItineraryRecordById(id);
  const itinerary = record?.itinerary ?? (await findPlanmeItineraryForDetailPage(id));

  if (!itinerary) {
    notFound();
  }

  const finalizationToken =
    record
      ? createRouteFinalizationToken(record.itinerary.id, record.revision)
      : undefined;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-[1920px] px-5 py-6 lg:px-8">
        <ItineraryDashboard
          itinerary={itinerary}
          compact
          finalizationToken={finalizationToken}
          routeFinalized={record?.routeFinalized ?? false}
          routeRevision={record?.revision ?? 0}
        />
      </div>
    </main>
  );
}
