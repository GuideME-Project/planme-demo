import { resolvePlanmeDestinationCountry } from "./planme-destination-country";
import type { resolveSelectedPlanmePlace, PlanmePlaceAttribution } from "./planme-places";

type SelectedPlace = NonNullable<Awaited<ReturnType<typeof resolveSelectedPlanmePlace>>>;
export type PlanmeGlobalTripPreparation = {
  origin: string;
  destination: string;
  countryName: string;
  internationalSide: "origin" | "destination";
  attributions?: PlanmePlaceAttribution[];
};

// Selected places must already have passed server-side Details verification.
export async function resolvePlanmeGlobalTrip(input: {
  origin: string;
  destination: string;
  selectedOrigin: SelectedPlace | null;
  selectedDestination: SelectedPlace | null;
}): Promise<PlanmeGlobalTripPreparation | null> {
  const [originCountry, destinationCountry] = await Promise.all([
    countryFor(input.origin, input.selectedOrigin),
    countryFor(input.destination, input.selectedDestination),
  ]);
  const internationalSide = destinationCountry.status === "international" ? "destination"
    : originCountry.status === "international" ? "origin" : null;
  if (!internationalSide) return null;
  const country = internationalSide === "destination" ? destinationCountry : originCountry;
  if (country.status !== "international") return null;
  const attributions = [input.selectedOrigin, input.selectedDestination].flatMap((place) => place?.attributions ?? []);
  return {
    origin: input.selectedOrigin?.name ?? input.origin,
    destination: input.selectedDestination?.name ?? input.destination,
    countryName: country.countryName,
    internationalSide,
    ...(attributions.length ? { attributions } : {}),
  };
}

function countryFor(query: string, selected: SelectedPlace | null) {
  if (!selected) return resolvePlanmeDestinationCountry(query);
  return selected.countryCode === "KR"
    ? { status: "domestic" as const, destination: query }
    : { status: "international" as const, countryName: selected.countryName, countryCode: selected.countryCode };
}
