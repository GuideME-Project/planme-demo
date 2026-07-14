import {
  searchPlanmePlaceCandidates,
  type PlanmeItinerary,
  type RouteStop,
} from "@planme/core";
import { RouteFinalizationError } from "./itinerary-route-finalizer";

/** Replaces browser-supplied coordinates with stored or provider-verified coordinates. */
export async function validateEditedItineraryPlaces(
  candidate: PlanmeItinerary,
  stored: PlanmeItinerary,
  signal: AbortSignal,
): Promise<PlanmeItinerary> {
  const trustedStops = createTrustedStopIndex(stored);
  const days = [] as PlanmeItinerary["days"];

  if (candidate.days.length !== stored.days.length) {
    throw new RouteFinalizationError("일차 구성은 이 화면에서 변경할 수 없습니다.");
  }

  for (const storedDay of stored.days) {
    const candidateDay = candidate.days.find((day) => day.day === storedDay.day);

    if (!candidateDay) {
      throw new RouteFinalizationError("일차 구성은 이 화면에서 변경할 수 없습니다.");
    }

    const carrymeStops = await validateStops(
      candidateDay.carryme.stops,
      stored.region,
      trustedStops,
      signal,
    );

    // Only CarryME stop order and the itinerary-wide mode are editable; AI copy and timelines stay stored.
    days.push({
      ...storedDay,
      carryme: { ...storedDay.carryme, stops: carrymeStops },
    });
  }

  return { ...stored, days, transportMode: candidate.transportMode };
}

/** Indexes server-stored place identities so reordered rows never trust browser coordinates. */
function createTrustedStopIndex(itinerary: PlanmeItinerary) {
  const index = new Map<string, RouteStop>();

  itinerary.days.forEach((day) => {
    [...day.standard.stops, ...day.carryme.stops].forEach((stop) => {
      const key = getStopIdentity(stop);

      if (key && stop.coordinate) {
        index.set(key, stop);
      }
    });
  });

  return index;
}

/** Validates route stops sequentially to avoid bursting Naver place search. */
async function validateStops(
  stops: RouteStop[],
  region: string,
  trustedStops: Map<string, RouteStop>,
  signal: AbortSignal,
) {
  const validated: RouteStop[] = [];

  for (const stop of stops) {
    const identity = getStopIdentity(stop);
    const storedStop = identity ? trustedStops.get(identity) : undefined;

    if (storedStop?.coordinate) {
      validated.push({
        ...stop,
        coordinate: storedStop.coordinate,
        placeId: storedStop.placeId,
        placeSource: storedStop.placeSource,
        placeSourceRef: storedStop.placeSourceRef,
      });
      continue;
    }

    if (!stop.placeSourceRef) {
      throw new RouteFinalizationError(`장소를 다시 선택해 주세요: ${stop.label}`);
    }

    const result = await searchPlanmePlaceCandidates(
      {
        maxCandidates: 5,
        query: stop.label,
        region,
        stop: {
          addressQuery: stop.label,
          name: stop.label,
          role: stop.role ?? "방문지",
        },
      },
      {
        fetchImpl: (input, init) => fetch(input, { ...init, signal }),
      },
    );
    const verified = result.candidates.find(
      (candidate) => candidate.sourceRef === stop.placeSourceRef,
    );

    if (!verified) {
      throw new RouteFinalizationError(`선택한 장소를 확인하지 못했습니다: ${stop.label}`);
    }

    // Provider identity and coordinate replace all browser-supplied location fields.
    validated.push({
      ...stop,
      coordinate: verified.coordinate,
      label: verified.name,
      placeId: verified.placeId,
      placeSource: verified.source,
      placeSourceRef: verified.sourceRef,
    });
  }

  return validated;
}

/** Creates the stable identity used for stored-place reuse. */
function getStopIdentity(stop: RouteStop) {
  return stop.placeSourceRef || stop.placeId || "";
}
