import type { IncomingMessage, ServerResponse } from "node:http";
import { writeCorsHeaders, writeJson } from "../src/http-handler";

/**
 * Vercel health endpoint for the PlanME MCP deployment.
 */
export default function handler(_request: IncomingMessage, response: ServerResponse): void {
  // Keep the response dependency-free so Vercel health checks stay cheap.
  writeCorsHeaders(response);
  writeJson(response, 200, { ok: true, service: "planme-mcp" });
}
