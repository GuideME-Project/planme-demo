import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handlePlanmeMcpRequest } from "./http-handler.js";
import { writeCorsHeaders, writeJson } from "./http-utils.js";

const DEFAULT_PORT = 8787;

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

    await handlePlanmeMcpRequest(request, response);
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
