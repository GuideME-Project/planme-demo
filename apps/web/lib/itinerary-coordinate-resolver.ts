import {
  searchPlanmePlaceCandidates,
  type PlanmeItinerary,
  type RouteStop,
} from "@planme/core";

/** Resolves only missing stop coordinates with the first representative Naver candidate. */
export async function resolveMissingItineraryCoordinates(
  itinerary: PlanmeItinerary,
  signal: AbortSignal,
): Promise<PlanmeItinerary> {
  const cache = new Map<string, RouteStop>();
  const days = [] as PlanmeItinerary["days"];

  for (const day of itinerary.days) {
    const standardStops = await resolveStops(day.standard.stops, itinerary.region, cache, signal);
    const carrymeStops = await resolveStops(day.carryme.stops, itinerary.region, cache, signal);

    days.push({
      ...day,
      standard: { ...day.standard, stops: standardStops },
      carryme: { ...day.carryme, stops: carrymeStops },
    });
  }

  return { ...itinerary, days };
}

/** Resolves missing stops sequentially and reuses the same representative place across routes. */
async function resolveStops(
  stops: RouteStop[],
  region: string,
  cache: Map<string, RouteStop>,
  signal: AbortSignal,
) {
  const resolved: RouteStop[] = [];

  for (const stop of stops) {
    if (stop.coordinate) {
      resolved.push(stop);
      continue;
    }

    const cacheKey = stop.placeSourceRef || `${region}:${stop.label}`;
    const cached = cache.get(cacheKey);

    if (cached?.coordinate) {
      resolved.push({
        ...stop,
        coordinate: cached.coordinate,
        placeId: cached.placeId,
        placeSource: cached.placeSource,
        placeSourceRef: cached.placeSourceRef,
      });
      continue;
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
    const representative = result.candidates[0];

    if (!representative?.coordinate) {
      throw new Error(`좌표를 찾지 못했습니다: ${stop.label}`);
    }

    const resolvedStop: RouteStop = {
      ...stop,
      coordinate: representative.coordinate,
      label: representative.name,
      placeId: representative.placeId,
      placeSource: representative.source,
      placeSourceRef: representative.sourceRef,
    };

    cache.set(cacheKey, resolvedStop);
    resolved.push(resolvedStop);
  }

  return resolved;
}
