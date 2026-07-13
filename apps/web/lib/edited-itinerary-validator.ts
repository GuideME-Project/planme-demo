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
      createTrustedStopIndex(storedDay.carryme.stops),
      signal,
      storedDay.day,
    );

    // Only CarryME stop order and the itinerary-wide mode are editable; AI copy and timelines stay stored.
    days.push({
      ...storedDay,
      carryme: { ...storedDay.carryme, stops: carrymeStops },
    });
  }

  return { ...stored, days, transportMode: candidate.transportMode };
}

type TrustedStopIndex = {
  byPlaceIdentity: Map<string, RouteStop[]>;
  byStopRef: Map<string, RouteStop>;
};

/** Indexes one stored CarryME route by logical visit and physical place identity. */
function createTrustedStopIndex(stops: RouteStop[]): TrustedStopIndex {
  const byPlaceIdentity = new Map<string, RouteStop[]>();
  const byStopRef = new Map<string, RouteStop>();

  stops.forEach((stop) => {
    const placeIdentity = getPlaceIdentity(stop);

    if (placeIdentity && stop.coordinate) {
      byPlaceIdentity.set(placeIdentity, [
        ...(byPlaceIdentity.get(placeIdentity) ?? []),
        stop,
      ]);
    }

    if (stop.stopRef) {
      byStopRef.set(stop.stopRef, stop);
    }
  });

  return { byPlaceIdentity, byStopRef };
}

/** Validates route stops sequentially to avoid bursting Naver place search. */
async function validateStops(
  stops: RouteStop[],
  region: string,
  trustedStops: TrustedStopIndex,
  signal: AbortSignal,
  dayNumber: number,
) {
  const validated: RouteStop[] = [];
  const usedStopRefs = new Set<string>();

  for (const [stopIndex, stop] of stops.entries()) {
    const storedStopByRef = stop.stopRef
      ? trustedStops.byStopRef.get(stop.stopRef)
      : undefined;
    const placeIdentity = getPlaceIdentity(stop);
    const keepsStoredPlace =
      storedStopByRef && getPlaceIdentity(storedStopByRef) === placeIdentity;

    if (storedStopByRef?.placeConstraint === "fixed" && !keepsStoredPlace) {
      throw new RouteFinalizationError(`고정 장소는 변경할 수 없습니다: ${storedStopByRef.label}`);
    }

    const storedStop = keepsStoredPlace
      ? storedStopByRef
      : storedStopByRef
        ? undefined
        : findUnusedStoredStopByPlace(
            placeIdentity,
            stop.role,
            trustedStops,
            usedStopRefs,
          );

    if (storedStop?.coordinate) {
      if (storedStop.stopRef) {
        usedStopRefs.add(storedStop.stopRef);
      }

      validated.push({
        ...stop,
        caption: storedStop.caption,
        coordinate: storedStop.coordinate,
        icon: storedStop.icon,
        label: storedStop.label,
        placeConstraint: storedStop.placeConstraint,
        placeId: storedStop.placeId,
        placeRef: storedStop.placeRef,
        placeSource: storedStop.placeSource,
        placeSourceRef: storedStop.placeSourceRef,
        role: storedStop.role,
        stopRef: storedStop.stopRef,
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
    const stopRef =
      storedStopByRef?.stopRef ??
      createEditedStopRef(dayNumber, stopIndex, usedStopRefs);
    usedStopRefs.add(stopRef);
    validated.push({
      ...stop,
      coordinate: verified.coordinate,
      label: verified.name,
      placeConstraint: storedStopByRef?.placeConstraint ?? "replaceable",
      placeId: verified.placeId,
      placeRef: `edited-place:${verified.sourceRef}`,
      placeSource: verified.source,
      placeSourceRef: verified.sourceRef,
      role: storedStopByRef?.role ?? stop.role,
      stopRef,
    });
  }

  return validated;
}

/** Selects one same-place visit without collapsing repeated visits into one stop reference. */
function findUnusedStoredStopByPlace(
  placeIdentity: string,
  role: RouteStop["role"],
  trustedStops: TrustedStopIndex,
  usedStopRefs: ReadonlySet<string>,
) {
  const candidates = trustedStops.byPlaceIdentity.get(placeIdentity) ?? [];
  const unused = candidates.filter(
    (candidate) => !candidate.stopRef || !usedStopRefs.has(candidate.stopRef),
  );

  return unused.find((candidate) => candidate.role === role) ?? unused[0];
}

/** Creates a collision-free visit reference for a newly added, provider-verified row. */
function createEditedStopRef(
  dayNumber: number,
  stopIndex: number,
  usedStopRefs: ReadonlySet<string>,
) {
  const base = `day-${dayNumber}-edited-stop-${stopIndex + 1}`;
  let suffix = 1;
  let stopRef = base;

  while (usedStopRefs.has(stopRef)) {
    suffix += 1;
    stopRef = `${base}-${suffix}`;
  }

  return stopRef;
}

/** Creates the provider-backed physical-place identity used for stored-coordinate reuse. */
function getPlaceIdentity(stop: RouteStop) {
  return stop.placeSourceRef || stop.placeId || "";
}
