import { NextResponse } from "next/server";
import {
  createRecommendedItineraryResponse,
  type RecommendItineraryRequest,
} from "@/lib/gpt-actions";

/**
 * Creates a technical-validation PlanME itinerary for Custom GPT Actions.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as RecommendItineraryRequest;

  // The demo endpoint maps GPT action arguments into a deterministic mock itinerary response.
  return NextResponse.json(createRecommendedItineraryResponse(request.url, body));
}
