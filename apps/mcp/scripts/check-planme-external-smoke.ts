import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPlanmeHttpServer } from "../src/server.js";

type SmokeContent = {
  clarificationContext?: {
    previousAnswers: string[];
    previousQuestions: string[];
    round: number;
    unresolvedPlaces: string[];
  };
  pageUrl?: string;
  questions?: string[];
  status?: "ready" | "needs_clarification";
  title?: string;
  unresolvedStops?: string[];
};

type SmokeToolPayload = {
  isError?: boolean;
  structuredContent?: SmokeContent;
};

type SmokeToolArguments = {
  clarificationAnswers?: string[];
  clarificationContext?: SmokeContent["clarificationContext"];
  destination: string;
  durationDays: number;
  origin: string;
  preferences: string[];
  travelerCount: number;
  luggageCount: number;
};

const usageEstimate = [
  ["OpenAI", "약 2~4건"],
  ["Google Places", "약 2~6건"],
  ["Naver", "약 1~3건"],
  ["ODsay", "약 5~15건"],
] as const;

/**
 * Runs the guarded real-provider smoke for GUI-157 only after explicit confirmation.
 */
async function main(): Promise<void> {
  printUsageEstimate();

  if (!hasExternalApiConfirmation()) {
    console.error(
      [
        "실제 API smoke는 실행하지 않았습니다.",
        "실행하려면 --confirm-external-api 또는 PLANME_CONFIRM_EXTERNAL_API_SMOKE=1을 지정하세요.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  assertRequiredRuntime();
  await assertWebOriginReachable();
  await runMcpRecommendationSmoke();
}

/**
 * Prints the expected provider usage without exposing any secret values.
 */
function printUsageEstimate(): void {
  console.log("정확한 검증을 위한 실제 API 테스트 예상 사용량:");

  for (const [provider, estimate] of usageEstimate) {
    console.log(`- ${provider}: ${estimate}`);
  }
}

/**
 * Checks whether the caller explicitly accepted real provider usage.
 */
function hasExternalApiConfirmation(): boolean {
  return (
    process.argv.includes("--confirm-external-api") ||
    process.env.PLANME_CONFIRM_EXTERNAL_API_SMOKE === "1"
  );
}

/**
 * Verifies required env var groups by name only, never by printing values.
 */
function assertRequiredRuntime(): void {
  const missingGroups = [
    hasRuntimeValue("OPENAI_API_KEY") ? "" : "OPENAI_API_KEY",
    hasAnyRuntimeValue(["PLANME_GOOGLE_MAPS_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"])
      ? ""
      : "PLANME_GOOGLE_MAPS_API_KEY 또는 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
    hasAnyRuntimeValue([
      "NAVER_MAPS_CLIENT_ID",
      "NCP_MAPS_CLIENT_ID",
      "NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID",
    ])
      ? ""
      : "NAVER_MAPS_CLIENT_ID 또는 NCP_MAPS_CLIENT_ID",
    hasAnyRuntimeValue(["NAVER_MAPS_CLIENT_SECRET", "NCP_MAPS_CLIENT_SECRET"])
      ? ""
      : "NAVER_MAPS_CLIENT_SECRET 또는 NCP_MAPS_CLIENT_SECRET",
    hasRuntimeValue("NAVER_SEARCH_CLIENT_ID") ? "" : "NAVER_SEARCH_CLIENT_ID",
    hasRuntimeValue("NAVER_SEARCH_CLIENT_SECRET") ? "" : "NAVER_SEARCH_CLIENT_SECRET",
    hasRuntimeValue("NEXT_PUBLIC_ODSAY_API_KEY") ? "" : "NEXT_PUBLIC_ODSAY_API_KEY",
    hasRuntimeValue("PLANME_WEB_ORIGIN") ? "" : "PLANME_WEB_ORIGIN",
    hasRuntimeValue("UPSTASH_REDIS_REST_URL") ? "" : "UPSTASH_REDIS_REST_URL",
    hasRuntimeValue("UPSTASH_REDIS_REST_TOKEN") ? "" : "UPSTASH_REDIS_REST_TOKEN",
  ].filter(Boolean);

  assert.equal(
    missingGroups.length,
    0,
    `실제 API smoke에 필요한 환경변수가 없습니다: ${missingGroups.join(", ")}`,
  );
}

/**
 * Checks that a specific runtime variable has a non-empty value.
 */
function hasRuntimeValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Checks whether at least one variable in an alias group is configured.
 */
function hasAnyRuntimeValue(names: string[]): boolean {
  return names.some(hasRuntimeValue);
}

/**
 * Confirms the web app is reachable before starting provider-consuming MCP generation.
 */
async function assertWebOriginReachable(): Promise<void> {
  const response = await fetch(new URL("/", getPlanmeWebOrigin()), {
    method: "GET",
  });

  assert.ok(
    response.ok,
    `PLANME_WEB_ORIGIN이 응답하지 않습니다. 실제 API 호출 전 로컬 web 서버를 먼저 확인하세요. status=${response.status}`,
  );
}

/**
 * Reads and normalizes the configured PlanME web origin.
 */
function getPlanmeWebOrigin(): string {
  return new URL(process.env.PLANME_WEB_ORIGIN ?? "").origin;
}

/**
 * Starts local MCP and calls the real itinerary tool through bounded clarification rounds.
 */
async function runMcpRecommendationSmoke(): Promise<void> {
  const server = await createPlanmeHttpServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const { port } = address as AddressInfo;
  const client = new Client({
    name: "planme-external-smoke",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );

  try {
    await client.connect(transport);

    const payload = await callRecommendUntilReady(client);

    assert.ok(payload.structuredContent?.pageUrl, "ready 응답에 pageUrl이 없습니다.");
    assert.ok(
      payload.structuredContent.pageUrl.startsWith(`${getPlanmeWebOrigin()}/itinerary/`),
      `pageUrl origin이 PLANME_WEB_ORIGIN과 다릅니다: ${payload.structuredContent.pageUrl}`,
    );

    const pageResponse = await fetch(payload.structuredContent.pageUrl);

    assert.ok(pageResponse.ok, `생성된 pageUrl이 열리지 않습니다. status=${pageResponse.status}`);

    console.log("PlanME external MCP smoke passed.");
    console.log(`pageUrl=${payload.structuredContent.pageUrl}`);
    console.log("ODsay 실제 브라우저 경로 재계산은 생성된 페이지에서 이어서 확인하세요.");
  } finally {
    await client.close();
    server.close();
  }
}

/**
 * Calls recommend_planme_itinerary and answers clarification prompts with bounded retries.
 */
async function callRecommendUntilReady(client: Client): Promise<SmokeToolPayload> {
  const baseArguments: SmokeToolArguments = {
    destination: "경상남도 거제시",
    durationDays: 3,
    origin: "강원도 양양",
    preferences: ["낚시", "바다전망 숙소"],
    travelerCount: 2,
    luggageCount: 2,
  };
  let argumentsForCall: SmokeToolArguments = baseArguments;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: argumentsForCall,
    });
    const payload = result as SmokeToolPayload;

    assert.equal(payload.isError, undefined, "MCP recommend_planme_itinerary returned an error.");

    if (payload.structuredContent?.status === "ready") {
      return payload;
    }

    if (payload.structuredContent?.status !== "needs_clarification") {
      throw new Error(`Unexpected smoke status: ${payload.structuredContent?.status ?? "missing"}`);
    }

    if (!payload.structuredContent.clarificationContext || attempt >= 2) {
      throw new Error(
        [
          "실제 API smoke가 clarification을 해소하지 못했습니다.",
          `unresolved=${payload.structuredContent.unresolvedStops?.join(", ") || "unknown"}`,
        ].join(" "),
      );
    }

    console.log(
      `Clarification round ${payload.structuredContent.clarificationContext.round}: ${payload.structuredContent.unresolvedStops?.join(", ")}`,
    );
    argumentsForCall = {
      ...baseArguments,
      clarificationAnswers: createClarificationAnswers(payload.structuredContent),
      clarificationContext: payload.structuredContent.clarificationContext,
    };
  }

  throw new Error("실제 API smoke가 ready 상태에 도달하지 못했습니다.");
}

/**
 * Creates concise clarification answers without exposing provider payloads.
 */
function createClarificationAnswers(content: SmokeContent): string[] {
  const unresolved = content.unresolvedStops ?? content.clarificationContext?.unresolvedPlaces ?? [];

  if (unresolved.length === 0) {
    return ["사용자가 요청한 목적지와 선호 조건에 가장 직접적으로 맞는 실제 장소 자체로 확정해 주세요."];
  }

  return unresolved.map(
    (place) => `${place} 자체가 맞습니다. 같은 이름의 실제 장소 후보로 확정해 주세요.`,
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown external smoke failure";

  console.error(message);
  process.exitCode = 1;
});
