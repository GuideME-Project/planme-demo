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

type PlanmeWidgetResourceMeta = {
  ui?: {
    csp?: {
      connectDomains?: string[];
      frameDomains?: string[];
      resourceDomains?: string[];
    };
  };
  "openai/widgetCSP"?: {
    connect_domains?: string[];
    frame_domains?: string[];
    resource_domains?: string[];
  };
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
      uri: "ui://planme/itinerary-widget-v2.html",
    });
    const legacyResource = await client.readResource({
      uri: "ui://planme/itinerary-widget.html",
    });

    const firstResource = resource.contents[0];
    const firstLegacyResource = legacyResource.contents[0];
    const firstResourceMeta = firstResource?._meta as PlanmeWidgetResourceMeta | undefined;

    assert.equal(firstResource?.mimeType, "text/html;profile=mcp-app");
    assert.ok(firstResource && "text" in firstResource);
    assert.equal(firstLegacyResource?.mimeType, "text/html;profile=mcp-app");
    assert.ok(firstLegacyResource && "text" in firstLegacyResource);
    assert.equal(firstResourceMeta?.ui?.csp?.frameDomains, undefined);
    assert.equal(firstResourceMeta?.["openai/widgetCSP"]?.frame_domains, undefined);
    assert.ok(!firstResourceMeta?.ui?.csp?.connectDomains?.some((domain) => domain.includes("google")));
    assert.ok(!firstResourceMeta?.ui?.csp?.resourceDomains?.some((domain) => domain.includes("google")));
    assert.ok(
      !firstResourceMeta?.["openai/widgetCSP"]?.connect_domains?.some((domain) =>
        domain.includes("google"),
      ),
    );
    assert.ok(
      !firstResourceMeta?.["openai/widgetCSP"]?.resource_domains?.some((domain) =>
        domain.includes("google"),
      ),
    );
    assert.match(firstResource.text, /PlanME/);
    assert.doesNotMatch(firstResource.text, /planme-route-preview/);
    assert.doesNotMatch(firstResource.text, /동선 미리보기/);
    assert.doesNotMatch(firstResource.text, /maps\.googleapis\.com/);
    assert.doesNotMatch(firstResource.text, /Google Maps/);
    assert.doesNotMatch(firstLegacyResource.text, /Google Maps/);
  } finally {
    await client.close();
    server.close();
  }

  console.log("PlanME MCP contract passed");
}

await main();
