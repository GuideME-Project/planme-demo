import type { ServerResponse } from "node:http";

/**
 * Writes a JSON response for non-MCP operational endpoints.
 */
export function writeJson(response: ServerResponse, statusCode: number, body: object): void {
  // Keep health and error responses simple so deployment probes can consume them.
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/**
 * Adds permissive CORS headers for local ChatGPT, Vercel, and inspector validation.
 */
export function writeCorsHeaders(response: ServerResponse): void {
  // The PoC is unauthenticated; production should narrow origins before public submission.
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,mcp-session-id,mcp-protocol-version");
  response.setHeader("access-control-expose-headers", "mcp-session-id");
}
