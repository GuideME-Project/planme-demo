import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItineraryDashboard } from "@/components/itinerary/ItineraryDashboard";
import { V3ItineraryDetail } from "@/components/itinerary/V3ItineraryDetail";
import { createItineraryDisplayDto } from "@planme/core";
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
    const description = "TourAPI에서 확인된 장소로 만든 PlanME 여행 일정입니다.";
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
      images: [`/og/itinerary/${encodeURIComponent(id)}.png`],
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
    const display = revision
      ? createItineraryDisplayDto(
          revision,
          new URL(`/itinerary/${encodeURIComponent(id)}`, pageOrigin).toString(),
        )
      : null;
    const scheduledDays = revision
      ? revision.standard.days.map((day) => ({
          day: day.day,
          visits: day.visits.flatMap((visit) => {
            const place = revision.selectedPlaceSnapshots[visit.contentId];
            return place
              ? [
                  {
                    contentId: visit.contentId,
                    title: place.title,
                    startMinute: visit.startMinute,
                    endMinute: visit.endMinute,
                  },
                ]
              : [];
          }),
          meals: day.meals.map((meal) => ({
            kind: meal.kind,
            title: meal.contentId
              ? revision.selectedPlaceSnapshots[meal.contentId]?.title ?? "식사"
              : meal.kind === "lunch"
                ? "점심 식사"
                : "저녁 식사",
            startMinute: meal.startMinute,
            endMinute: meal.endMinute,
            locationStatus: meal.locationStatus,
          })),
          luggageEvents: revision.carryme.luggageEvents
            .filter((event) => event.day === day.day)
            .map((event) => ({
              kind: event.kind,
              title:
                event.kind === "handoff"
                  ? "CarryME 수하물 인계"
                  : `${revision.plan.lodging.title} 수하물 도착`,
              minute: event.minute,
            })),
          idleBlocks: day.idleBlocks,
        }))
      : [];
    const editToken = revision
      ? safelyCreateEditToken(id, revision.revision)
      : undefined;
    const failedMessage = snapshot.meta.phase === "failed"
      ? "변경 계산에 실패해 기존 활성 일정을 유지했습니다."
      : undefined;
    const phase = revision && snapshot.meta.phase === "failed"
      ? "ready"
      : snapshot.meta.phase;

    return (
      <main className="min-h-screen bg-slate-100 px-5 py-8 lg:px-8">
        <V3ItineraryDetail
          itineraryId={id}
          phase={phase}
          display={display}
          scheduledDays={scheduledDays}
          estimatedWalkCount={
            revision?.standard.segments.filter(
              (segment) => segment.source === "estimated_walk",
            ).length ?? 0
          }
          lodging={
            revision
              ? {
                  contentId: revision.plan.lodging.contentId,
                  title: revision.plan.lodging.title,
                }
              : null
          }
          editToken={editToken}
          failedMessage={failedMessage}
        />
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

function safelyCreateEditToken(itineraryId: string, revision: number) {
  try {
    return createRouteFinalizationToken(itineraryId, revision);
  } catch {
    return undefined;
  }
}
