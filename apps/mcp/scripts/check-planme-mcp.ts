import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPlanmeHttpServer } from "../src/server.js";

type RecommendationContent = {
  itineraryId?: string;
  pageUrl?: string;
  title?: string;
  savedMinutes?: number;
  timeline?: Array<{
    title?: string;
  }>;
};

type PlanningContent = {
  status?: "needs_input" | "ready";
  missingSlots?: string[];
  nextAction?: "ask_user" | "draft_planme_itinerary";
  questions?: Array<{
    slot?: string;
    text?: string;
  }>;
};

type DraftPreviewContent = RecommendationContent & {
  previewId?: string;
  status?: "preview_ready" | "needs_revision" | "committed";
  validationIssues?: Array<{
    code?: string;
    message?: string;
    severity?: string;
  }>;
  version?: number;
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
    assert.ok(toolNames.includes("start_planme_planning"));
    assert.ok(toolNames.includes("preview_planme_itinerary"));
    assert.ok(toolNames.includes("update_planme_itinerary_preview"));
    assert.ok(toolNames.includes("commit_planme_itinerary"));

    const planningDraft = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
      },
    });
    const planningDraftContent = planningDraft.structuredContent as PlanningContent | undefined;

    assert.equal(planningDraft.isError, undefined);
    assert.equal(planningDraftContent?.status, "needs_input");
    assert.equal(planningDraftContent?.nextAction, "ask_user");
    assert.ok(planningDraftContent?.missingSlots?.includes("origin"));
    assert.ok(planningDraftContent?.missingSlots?.includes("durationDays"));
    assert.ok(planningDraftContent?.questions?.some((question) => question.slot === "origin"));
    assert.ok(
      planningDraftContent?.questions?.some((question) => question.slot === "durationDays"),
    );

    const readyPlanning = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
        durationDays: 2,
        origin: "서울",
      },
    });
    const readyPlanningContent = readyPlanning.structuredContent as PlanningContent | undefined;

    assert.equal(readyPlanning.isError, undefined);
    assert.equal(readyPlanningContent?.status, "ready");
    assert.equal(readyPlanningContent?.nextAction, "draft_planme_itinerary");
    assert.deepEqual(readyPlanningContent?.missingSlots, []);

    const recommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "부산",
        durationDays: 2,
        travelerCount: 1,
        luggageCount: 1,
      },
    });

    assert.equal(recommendation.isError, undefined);
    const structuredContent = recommendation.structuredContent as RecommendationContent | undefined;

    assert.match(structuredContent?.itineraryId ?? "", /^generated-부산-/);
    assert.equal(structuredContent?.savedMinutes, 70);

    const yeosuRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "여수",
        durationDays: 2,
        hotelName: "여수 베네치아 호텔",
        preferences: ["낚시여행"],
        travelerCount: 1,
        luggageCount: 1,
      },
    });
    const yeosuStructuredContent =
      yeosuRecommendation.structuredContent as RecommendationContent | undefined;

    assert.equal(yeosuRecommendation.isError, undefined);
    assert.equal(yeosuStructuredContent?.title, "PlanME 여수 낚시여행 1박 2일 추천 일정");
    assert.ok(yeosuStructuredContent?.pageUrl?.includes("/itinerary/generated-"));
    assert.equal(yeosuStructuredContent?.timeline?.[0]?.title, "여수 베네치아 호텔 출발");

    const seoulToYeosuRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "여수",
        durationDays: 2,
        hotelName: "여수 베네치아 호텔",
        preferences: ["서울 출발"],
        travelerCount: 1,
        luggageCount: 1,
      },
    });
    const seoulToYeosuStructuredContent =
      seoulToYeosuRecommendation.structuredContent as RecommendationContent | undefined;

    assert.equal(seoulToYeosuRecommendation.isError, undefined);
    assert.equal(
      seoulToYeosuStructuredContent?.title,
      "PlanME 서울 → 여수 밤바다 1박 2일 추천 일정",
    );
    assert.doesNotMatch(seoulToYeosuStructuredContent?.title ?? "", /여수 서울 출발/);

    const namhaeFallback = await client.callTool({
      name: "get_planme_itinerary",
      arguments: {
        itineraryId: "generated-남해-아이-동반-가족여행-2d-pkv5dr",
      },
    });
    const namhaeFallbackContent =
      namhaeFallback.structuredContent as RecommendationContent | undefined;

    assert.equal(namhaeFallback.isError, undefined);
    assert.equal(
      namhaeFallbackContent?.title,
      "PlanME 남해 아이 동반 가족여행 1박 2일 추천 일정",
    );
    assert.ok(
      namhaeFallbackContent?.timeline?.every((timelineItem) =>
        !timelineItem.title?.includes("부산역"),
      ),
    );

    const namhaeDraftRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "남해",
        durationDays: 2,
        title: "남해 아이 동반 가족여행 1박 2일 초안",
        region: "남해",
        duration: "1박 2일",
        summary: "아이 동반 가족이 남해 대표 방문지를 무리 없이 보는 초안입니다.",
        assumptions: ["동탄 출발", "아이 동반", "해안 산책 위주"],
        savedMinutes: 50,
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [
              { name: "동탄", role: "origin", caption: "출발" },
              { name: "남해 독일마을", role: "visit", caption: "관광" },
              { name: "물건리 방조어부림", role: "visit", caption: "해안 산책" },
              { name: "남해 숙소", role: "luggageDestination", caption: "짐 도착" },
            ],
            timeline: [
              {
                time: "09:00",
                title: "동탄 출발",
                description: "가족 여행 일정을 시작합니다.",
                category: "arrival",
              },
              {
                time: "13:30",
                title: "남해 독일마을 산책",
                description: "아이와 함께 마을과 바다 전망을 가볍게 봅니다.",
                category: "event",
              },
              {
                time: "15:30",
                title: "물건리 방조어부림 해안 산책",
                description: "무리 없는 해안 산책 코스로 이동합니다.",
                category: "event",
                savingLabel: "약 50분 절약",
              },
            ],
          },
        ],
      },
    });
    const namhaeDraftRecommendationContent =
      namhaeDraftRecommendation.structuredContent as DraftPreviewContent | undefined;
    const namhaeDraftWidgetMeta = JSON.stringify(namhaeDraftRecommendation._meta ?? {});

    assert.equal(namhaeDraftRecommendation.isError, undefined);
    assert.equal(namhaeDraftRecommendationContent?.status, "preview_ready");
    assert.doesNotMatch(namhaeDraftRecommendationContent?.pageUrl ?? "", /\/itinerary\/preview-/);
    assert.equal(
      namhaeDraftRecommendationContent?.title,
      "남해 아이 동반 가족여행 1박 2일 초안",
    );
    assert.equal(
      namhaeDraftRecommendationContent?.timeline?.[1]?.title,
      "남해 독일마을 산책",
    );
    assert.match(namhaeDraftWidgetMeta, /남해 독일마을/);
    assert.match(namhaeDraftWidgetMeta, /물건리 방조어부림/);
    assert.doesNotMatch(namhaeDraftWidgetMeta, /남해 아이 동반 가족여행 방문/);

    const namhaeLongRouteTitle =
      "남해 독일마을 · 원예예술촌 · 물건방조어부림 · 남해보물섬전망대 · 설리스카이워크 · 상주은모래비치 1박 2일";
    const namhaeLongDraftRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "남해",
        durationDays: 2,
        title: namhaeLongRouteTitle,
        region: "남해",
        duration: "1박 2일",
        summary: "아이 동반 가족이 남해 대표 방문지를 무리 없이 보는 초안입니다.",
        assumptions: ["동탄 출발", "아이 동반"],
        savedMinutes: 70,
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [
              { name: "남해 독일마을", role: "origin", caption: "출발" },
              { name: "원예예술촌", role: "visit", caption: "산책" },
              { name: "물건방조어부림", role: "visit", caption: "해안 산책" },
              { name: "남해보물섬전망대", role: "visit", caption: "전망" },
              { name: "설리스카이워크", role: "visit", caption: "체험" },
              { name: "상주은모래비치", role: "finalDestination", caption: "도착" },
            ],
            timeline: [
              {
                time: "09:30",
                title: `${namhaeLongRouteTitle} 출발`,
                description: "숙소 또는 출발지에서 출발합니다.",
                category: "arrival",
              },
              {
                time: "10:00",
                title: "캐리미 짐 탁송 완료",
                description: "짐은 CarryME가 이동합니다.",
                category: "carryme",
              },
              {
                time: "10:20",
                title: `${namhaeLongRouteTitle} 이동 시작`,
                description: "가벼운 일정 이동을 시작합니다.",
                category: "transit",
              },
              {
                time: "15:00",
                title: `${namhaeLongRouteTitle} 방문`,
                description: "주요 방문지를 둘러봅니다.",
                category: "event",
              },
              {
                time: "21:30",
                title: `${namhaeLongRouteTitle} 수령 지점 짐 수령`,
                description: "일정을 마치고 짐을 수령합니다.",
                category: "hotel",
              },
            ],
          },
        ],
      },
    });
    const namhaeLongDraftContent =
      namhaeLongDraftRecommendation.structuredContent as DraftPreviewContent | undefined;

    assert.equal(namhaeLongDraftRecommendation.isError, undefined);
    assert.equal(namhaeLongDraftContent?.title, "남해 1박 2일 일정 초안");
    assert.doesNotMatch(namhaeLongDraftContent?.title ?? "", /·/);
    assert.equal(namhaeLongDraftContent?.timeline?.[0]?.title, "남해 독일마을 출발");
    assert.doesNotMatch(namhaeLongDraftContent?.timeline?.[2]?.title ?? "", /·/);
    assert.doesNotMatch(namhaeLongDraftContent?.timeline?.[3]?.title ?? "", /·/);

    const yeosuFamilyPreview = await client.callTool({
      name: "preview_planme_itinerary",
      arguments: {
        title: "여수 가족 여행 1박 2일 초안",
        region: "여수",
        duration: "1박 2일",
        summary: "가족이 무리 없이 바다와 실내 관광을 함께 보는 초안입니다.",
        assumptions: ["숙소는 아직 미정", "아이 동반 가족 여행"],
        savedMinutes: 45,
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [
              { name: "서울역", role: "origin", caption: "출발" },
              { name: "아쿠아플라넷 여수", role: "visit", caption: "실내 관광" },
              { name: "오동도", role: "visit", caption: "산책" },
              { name: "숙소", role: "luggageDestination", caption: "짐 도착" },
            ],
            timeline: [
              {
                time: "09:00",
                title: "서울역 출발",
                description: "가족 여행 일정을 시작합니다.",
                category: "arrival",
              },
              {
                time: "13:30",
                title: "아쿠아플라넷 여수 방문",
                description: "실내 중심으로 아이가 보기 쉬운 코스입니다.",
                category: "event",
              },
              {
                time: "16:00",
                title: "오동도 산책",
                description: "짧은 산책으로 바다 전망을 봅니다.",
                category: "event",
                savingLabel: "약 45분 절약",
              },
            ],
          },
        ],
      },
    });
    const yeosuFamilyPreviewContent =
      yeosuFamilyPreview.structuredContent as DraftPreviewContent | undefined;

    assert.equal(yeosuFamilyPreview.isError, undefined);
    assert.equal(yeosuFamilyPreviewContent?.status, "preview_ready");
    assert.match(yeosuFamilyPreviewContent?.previewId ?? "", /^preview-/);
    assert.doesNotMatch(yeosuFamilyPreviewContent?.pageUrl ?? "", /\/itinerary\/preview-/);
    assert.equal(yeosuFamilyPreviewContent?.title, "여수 가족 여행 1박 2일 초안");
    assert.equal(yeosuFamilyPreviewContent?.timeline?.[1]?.title, "아쿠아플라넷 여수 방문");
    assert.equal(yeosuFamilyPreviewContent?.validationIssues?.length, 0);

    const committedPreview = await client.callTool({
      name: "commit_planme_itinerary",
      arguments: {
        previewId: yeosuFamilyPreviewContent?.previewId,
        version: yeosuFamilyPreviewContent?.version,
        userConfirmed: true,
        idempotencyKey: "contract-yeosu-family-preview",
        visibility: "public",
      },
    });
    const committedPreviewContent =
      committedPreview.structuredContent as DraftPreviewContent | undefined;

    assert.equal(committedPreview.isError, undefined);
    assert.equal(committedPreviewContent?.status, "committed");
    assert.equal(committedPreviewContent?.title, "여수 가족 여행 1박 2일 초안");

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
    assert.match(firstResource.text, /window\.openai/);
    assert.match(firstResource.text, /toolOutput/);
    assert.match(firstResource.text, /openai:set_globals/);
    assert.match(firstResource.text, /ui\/notifications\/tool-result/);
    assert.doesNotMatch(firstResource.text, /부산 1박 2일/);
    assert.doesNotMatch(firstResource.text, /인천공항 도착/);
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
