import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGptsPlanningStartRequest } from "../../../src/gpts-actions-api.js";

/**
 * Vercel Serverless Function entrypoint for GPTs Actions planning readiness checks.
 */
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  // Keep GPTs planning behavior aligned with the Apps SDK start_planme_planning tool.
  await handleGptsPlanningStartRequest(request, response);
}
