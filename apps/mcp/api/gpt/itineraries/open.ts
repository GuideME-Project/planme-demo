import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGptsItineraryOpenRequest } from "../../../src/gpts-actions-api.js";

/**
 * Keeps the GPT-visible link on the approved Action domain, then redirects to the web detail page.
 */
export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  handleGptsItineraryOpenRequest(request, response);
}
