import { ItineraryDashboard } from "@/components/itinerary/ItineraryDashboard";
import { getDemoItinerary } from "@planme/core";

/**
 * Renders the PlanME demo landing page.
 */
export default function Home() {
  const itinerary = getDemoItinerary();

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
        <ItineraryDashboard itinerary={itinerary} compact={false} />
      </div>
    </main>
  );
}
