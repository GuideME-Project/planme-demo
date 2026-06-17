import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlanmeMcpServer } from "./planme-mcp";

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

/**
 * Handles a Streamable HTTP MCP request in a stateless Vercel-compatible form.
 */
export async function handlePlanmeMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  writeCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const mcpServer = createPlanmeMcpServer();
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    transport.onerror = (error) => {
      // Surface SDK transport failures during local Apps SDK validation.
      console.error("PlanME MCP transport error", error);
    };

    await mcpServer.connect(transport);

    // Streamable HTTP transport owns MCP JSON-RPC parsing and response semantics.
    await transport.handleRequest(request, response);
    await mcpServer.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP request failed";

    if (!response.headersSent) {
      writeJson(response, 500, { error: message });
    } else {
      response.end();
    }
  }
}
