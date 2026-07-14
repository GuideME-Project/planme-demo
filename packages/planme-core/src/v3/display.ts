import type {
  DisplayPlace,
  ItineraryDisplayDto,
  ItineraryRevision,
  TourPlaceSnapshot,
} from "./contracts.js";

export function createItineraryDisplayDto(
  revision: ItineraryRevision,
  pageUrl: string,
): ItineraryDisplayDto | null {
  const days = [];

  for (const day of revision.plan.days) {
    const visits: DisplayPlace[] = [];

    for (const visit of day.visits) {
      const snapshot = revision.selectedPlaceSnapshots[visit.contentId];
      if (!snapshot) {
        return null;
      }
      if (snapshot.contentTypeId === 39) {
        continue;
      }
      visits.push(toDisplayPlace(snapshot));
    }

    days.push({ day: day.day, visits });
  }

  return {
    itineraryId: revision.itineraryId,
    revision: revision.revision,
    title: `${revision.intent.destination} 여행 일정`,
    region: revision.intent.destination,
    durationDays: revision.intent.durationDays,
    transportMode: revision.intent.transportMode,
    days,
    standardTotalMinutes: revision.standard.totalMinutes,
    carrymeTotalMinutes: revision.carryme.totalMinutes,
    savedMinutes: Math.max(
      0,
      revision.standard.totalMinutes - revision.carryme.totalMinutes,
    ),
    pageUrl,
  };
}

function toDisplayPlace(snapshot: TourPlaceSnapshot): DisplayPlace {
  return {
    contentId: snapshot.contentId,
    contentTypeId: snapshot.contentTypeId,
    title: snapshot.title,
    coordinate: snapshot.coordinate,
    address: snapshot.address,
  };
}
