import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPlanmeHttpServer } from "../src/server.js";

type RecommendationContent = {
  itineraryId?: string;
  savedMinutes?: number;
};

/**
 * Starts the PlanME MCP server on an ephemeral local port for contract checks.
 */
async function startServer() {
  const server = await createPlanmeHttpServer();

  // Port 0 avoids collisions with the web demo and Vercel preview checks.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const addressInfo = address as AddressInfo;

  return {
    server,
    url: new URL(`http://127.0.0.1:${addressInfo.port}/mcp`),
  };
}

/**
 * Verifies that PlanME MCP tools and resources satisfy the first GPT App PoC contract.
 */
async function main(): Promise<void> {
  const { server, url } = await startServer();
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({
    name: "planme-mcp-contract-check",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes("recommend_planme_itinerary"));
    assert.ok(toolNames.includes("get_planme_itinerary"));

    const recommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "오사카",
        durationDays: 2,
        travelerCount: 1,
        luggageCount: 1,
      },
    });

    assert.equal(recommendation.isError, undefined);
    const structuredContent = recommendation.structuredContent as RecommendationContent | undefined;

    assert.equal(structuredContent?.itineraryId, "osaka-2d1n");
    assert.equal(structuredContent?.savedMinutes, 120);

    const resource = await client.readResource({
      uri: "ui://planme/itinerary-widget.html",
    });

    const firstResource = resource.contents[0];

    assert.equal(firstResource?.mimeType, "text/html;profile=mcp-app");
    assert.ok(firstResource && "text" in firstResource);
    assert.match(firstResource.text, /PlanME/);
  } finally {
    await client.close();
    server.close();
  }

  console.log("PlanME MCP contract passed");
}

await main();
