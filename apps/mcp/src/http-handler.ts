import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlanmeMcpServer } from "./planme-mcp";
import { writeCorsHeaders, writeJson } from "./http-utils";

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
