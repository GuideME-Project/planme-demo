import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlanmeMcpServer } from "./planme-mcp";

const DEFAULT_PORT = 8787;

/**
 * Writes a JSON response for non-MCP operational endpoints.
 */
function writeJson(response: ServerResponse, statusCode: number, body: object): void {
  // Keep health and error responses simple so deployment probes can consume them.
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/**
 * Adds permissive CORS headers for local ChatGPT and inspector validation.
 */
function writeCorsHeaders(response: ServerResponse): void {
  // The PoC is unauthenticated; production should narrow origins before public submission.
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,mcp-session-id,mcp-protocol-version");
  response.setHeader("access-control-expose-headers", "mcp-session-id");
}

/**
 * Creates the HTTP server that exposes the PlanME MCP endpoint.
 */
export async function createPlanmeHttpServer() {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    writeCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url === "/health") {
      writeJson(response, 200, { ok: true, service: "planme-mcp" });
      return;
    }

    if (!request.url?.startsWith("/mcp")) {
      writeJson(response, 404, { error: "not_found" });
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
  });
}

/**
 * Starts the PlanME MCP HTTP server from the command line.
 */
async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  const server = await createPlanmeHttpServer();

  // Bind on all interfaces so local tunnels can reach the server during Apps SDK validation.
  server.listen(port, "0.0.0.0", () => {
    console.log(`PlanME MCP server listening on http://localhost:${port}/mcp`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
