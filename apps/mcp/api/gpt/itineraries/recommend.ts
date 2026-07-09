import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGptsRecommendItineraryRequest } from "../../../src/gpts-actions-api.js";

/**
 * Vercel Serverless Function entrypoint for GPTs Actions itinerary generation.
 */
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  // The handler generates with server-side OpenAI credentials, then persists through the web app.
  await handleGptsRecommendItineraryRequest(request, response);
}
