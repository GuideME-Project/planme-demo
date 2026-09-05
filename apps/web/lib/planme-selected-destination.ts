import { calculateStraightDistanceMeters } from "@planme/core";
import { createTourApiClient } from "./planme-v3/tour-api-client";
import type { resolveSelectedPlanmePlace } from "./planme-places";

// Conservative demo tolerance, not a provider identity guarantee. The real Everland
// provider centroids differ by 1,208m; require a unique title match AND at most 2km.
const SELECTED_PLACE_MAX_DISTANCE_METERS = 2_000;

export async function resolveSelectedDomesticDestination(selected: NonNullable<Awaited<ReturnType<typeof resolveSelectedPlanmePlace>>>) {
  if (selected.countryCode !== "KR") return null;
  if (selected.isAdministrativeArea) return { searchText: selected.searchText };
  try {
    // The existing resolver requires one exact/alias title match and a supported region.
    // Sending the address here would take its region-first branch and lose the POI.
    const resolution = await createTourApiClient().resolveDestination(selected.name, AbortSignal.timeout(5_000));
    const place = resolution?.place;
    const lat = Number(place?.mapy);
    const lng = Number(place?.mapx);
    if (!place || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const distanceMeters = calculateStraightDistanceMeters(selected.coordinate, { lat, lng });
    if (distanceMeters > SELECTED_PLACE_MAX_DISTANCE_METERS) return null;
    return { searchText: selected.name, placeTitle: place.title, distanceMeters };
  } catch {
    return null;
  }
}
