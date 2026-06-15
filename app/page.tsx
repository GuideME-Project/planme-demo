import { ChatGPTPreview } from "@/components/chatgpt-preview/ChatGPTPreview";
import { ItineraryDashboard } from "@/components/itinerary/ItineraryDashboard";
import { getDemoItinerary } from "@/lib/mock-data";

/**
 * Renders the PlanME demo landing page with a ChatGPT handoff preview.
 */
export default function Home() {
  const itinerary = getDemoItinerary();

  return (
    <main className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
        <ChatGPTPreview itinerary={itinerary} />
        <ItineraryDashboard itinerary={itinerary} compact={false} />
      </div>
    </main>
  );
}
