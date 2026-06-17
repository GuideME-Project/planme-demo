import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPlanmeMcpServer } from "./planme-mcp.js";
import { writeCorsHeaders, writeJson } from "./http-utils.js";

type ParsedBodyRequest = IncomingMessage & {
  body?: object | string | Buffer;
};

/**
 * Reads the JSON-RPC request body for serverless runtimes that pre-parse request streams.
 */
async function readJsonRpcBody(request: IncomingMessage): Promise<object | undefined> {
  const requestWithBody = request as ParsedBodyRequest;

  if (typeof requestWithBody.body === "string") {
    // Some runtimes keep the raw body as text; parse it before handing off to the MCP SDK.
    return JSON.parse(requestWithBody.body) as object;
  }

  if (Buffer.isBuffer(requestWithBody.body)) {
    // Buffer bodies are common in Node-compatible serverless adapters.
    return JSON.parse(requestWithBody.body.toString("utf8")) as object;
  }

  if (typeof requestWithBody.body === "object" && requestWithBody.body !== null) {
    // Vercel can expose the parsed request body directly on the request object.
    return requestWithBody.body;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    // Node IncomingMessage chunks are Buffer|string; normalize before parsing.
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as object;
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
    const body = request.method === "POST" ? await readJsonRpcBody(request) : undefined;
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
    await transport.handleRequest(request, response, body);
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
