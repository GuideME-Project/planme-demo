import type { IncomingMessage, ServerResponse } from "node:http";
import { handlePlanmeMcpRequest } from "../src/http-handler";

/**
 * Vercel Serverless Function entrypoint for the PlanME MCP endpoint.
 */
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  // Vercel invokes this function through /api/mcp; vercel.json rewrites /mcp to this handler.
  await handlePlanmeMcpRequest(request, response);
}
