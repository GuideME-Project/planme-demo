import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  decodePlanmePreviewPayload,
  generatePlanmeDraftWithOpenAi,
  PLANME_PREVIEW_DATA_PARAM,
} from "@planme/core";
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
 * Reads the stateless preview payload from a generated PlanME preview URL.
 */
function decodePreviewUrlItinerary(pageUrl: string) {
  const url = new URL(pageUrl);
  const payload = url.searchParams.get(PLANME_PREVIEW_DATA_PARAM);

  assert.ok(payload);

  return decodePlanmePreviewPayload(payload);
}

/**
 * Verifies the OpenAI generator boundary without calling the real OpenAI API.
 */
async function assertOpenAiGeneratorContract(): Promise<void> {
  let capturedBody = "";
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      destination: "남해 가족여행",
      durationDays: 2,
      origin: "동탄",
      preferences: ["아이 동반"],
      travelerCount: 4,
      luggageCount: 2,
    },
    {
      apiKey: "test-api-key",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              title: "남해 아이 동반 가족여행 1박 2일 초안",
              region: "남해",
              duration: "1박 2일",
              summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
              origin: "동탄",
              assumptions: ["동탄 출발", "아이 동반"],
              savedMinutes: 60,
              days: [
                {
                  day: 1,
                  label: "Day 1",
                  standardDurationMinutes: 420,
                  carrymeDurationMinutes: 360,
                  standardRouteText: "동탄 → 남해 숙소 → 남해 독일마을",
                  carrymeRouteText: "동탄 → 남해 독일마을 → 남해 숙소",
                  stops: [
                    { name: "동탄", role: "origin", caption: "출발" },
                    { name: "남해 독일마을", role: "visit", caption: "관광" },
                    { name: "남해 숙소", role: "luggageDestination", caption: "짐 도착" },
                  ],
                  timeline: [
                    {
                      time: "09:00",
                      title: "동탄 출발",
                      description: "가족 여행을 시작합니다.",
                      category: "arrival",
                      highlight: false,
                      savingLabel: "",
                    },
                    {
                      time: "14:00",
                      title: "남해 독일마을 방문",
                      description: "아이와 함께 가볍게 둘러봅니다.",
                      category: "event",
                      highlight: true,
                      savingLabel: "약 60분 절약",
                    },
                  ],
                },
              ],
            }),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  );

  assert.equal(generatedDraft.title, "남해 아이 동반 가족여행 1박 2일 초안");
  assert.equal(generatedDraft.days[0]?.timeline[0]?.title, "동탄 출발");
  assert.match(capturedBody, /json_schema/);
  assert.match(capturedBody, /PLANME_OPENAI_MODEL|test-model/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
}

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
  await assertOpenAiGeneratorContract();

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

    const missingAiGeneratorRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "남해 아이 동반 가족여행",
        durationDays: 2,
        travelerCount: 4,
        luggageCount: 2,
      },
    });
    const missingAiGeneratorPayload = JSON.stringify(missingAiGeneratorRecommendation);

    assert.equal(missingAiGeneratorRecommendation.isError, true);
    assert.match(missingAiGeneratorPayload, /OPENAI_API_KEY/);
    assert.doesNotMatch(missingAiGeneratorPayload, /인천공항/);
    assert.doesNotMatch(missingAiGeneratorPayload, /여수 베네치아 호텔/);
    assert.doesNotMatch(missingAiGeneratorPayload, /부산 공연장/);

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
    assert.match(
      namhaeDraftRecommendationContent?.pageUrl ?? "",
      /\/itinerary\/preview\?data=/,
    );
    assert.doesNotMatch(namhaeDraftRecommendationContent?.pageUrl ?? "", /#planme-preview/);
    const decodedNamhaeDraftItinerary = decodePreviewUrlItinerary(
      namhaeDraftRecommendationContent?.pageUrl ?? "",
    );

    assert.equal(decodedNamhaeDraftItinerary?.title, "남해 아이 동반 가족여행 1박 2일 초안");
    assert.equal(decodedNamhaeDraftItinerary?.days[0]?.timeline[1]?.title, "남해 독일마을 산책");
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
    assert.match(namhaeDraftWidgetMeta, /\/itinerary\/preview\?data=/);
    assert.doesNotMatch(namhaeDraftWidgetMeta, /#planme-preview/);
    assert.doesNotMatch(namhaeDraftWidgetMeta, /남해 아이 동반 가족여행 방문/);

    const namhaeDraftWithWrongAirport = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "남해",
        durationDays: 2,
        origin: "동탄",
        title: "남해 아이 동반 가족여행 1박 2일 초안",
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
              { name: "인천공항", role: "origin", caption: "입국" },
              { name: "남해 독일마을", role: "visit", caption: "관광" },
              { name: "상주은모래비치 인근 가족 숙소", role: "luggageDestination", caption: "짐 도착" },
            ],
            timeline: [
              {
                time: "11:30",
                title: "인천공항 도착",
                description: "입국 후 여행 일정 시작",
                category: "arrival",
              },
              {
                time: "12:00",
                title: "캐리미 짐 탁송 완료",
                description: "인천공항에서 상주은모래비치 인근 가족 숙소 배송 접수 완료",
                category: "carryme",
              },
              {
                time: "12:20",
                title: "남해 독일마을 이동 시작",
                description: "짐 없이 바로 목적지로 이동",
                category: "transit",
              },
            ],
          },
        ],
      },
    });
    const namhaeDraftWithWrongAirportContent =
      namhaeDraftWithWrongAirport.structuredContent as DraftPreviewContent | undefined;
    const namhaeDraftWithWrongAirportMeta = JSON.stringify(
      namhaeDraftWithWrongAirport._meta ?? {},
    );

    assert.equal(namhaeDraftWithWrongAirport.isError, undefined);
    assert.equal(namhaeDraftWithWrongAirportContent?.timeline?.[0]?.title, "동탄 출발");
    assert.match(namhaeDraftWithWrongAirportMeta, /동탄/);
    assert.doesNotMatch(namhaeDraftWithWrongAirportMeta, /인천공항/);

    const namhaeDraftMissingOriginWithWrongAirport = await client.callTool({
      name: "preview_planme_itinerary",
      arguments: {
        title: "Namhae German Village, House N Garden, Sangju Silver Sand Beach 1박 2일",
        region: "남해",
        duration: "1박 2일",
        summary: "아이 동반 가족이 남해 대표 방문지를 무리 없이 보는 초안입니다.",
        assumptions: ["아이 동반"],
        savedMinutes: 70,
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [
              { name: "인천공항", role: "origin", caption: "입국" },
              {
                name: "Namhae German Village, House N Garden, Sangju Silver Sand Beach",
                role: "visit",
                caption: "관광",
              },
              {
                name: "Lodging near Sangju Silver Sand Beach",
                role: "luggageDestination",
                caption: "짐 도착",
              },
            ],
            timeline: [
              {
                time: "09:30",
                title: "인천공항 도착",
                description: "입국 후 여행 일정 시작",
                category: "arrival",
              },
              {
                time: "10:20",
                title: "Namhae German Village, House N Garden, Sangju Silver Sand Beach 이동 시작",
                description: "아이 동반 가족 여행을 시작합니다.",
                category: "transit",
              },
            ],
          },
        ],
      },
    });
    const namhaeDraftMissingOriginContent =
      namhaeDraftMissingOriginWithWrongAirport.structuredContent as DraftPreviewContent | undefined;
    const namhaeDraftMissingOriginMeta = JSON.stringify(
      namhaeDraftMissingOriginWithWrongAirport._meta ?? {},
    );

    assert.equal(namhaeDraftMissingOriginWithWrongAirport.isError, undefined);
    assert.equal(namhaeDraftMissingOriginContent?.status, "needs_revision");
    assert.ok(
      namhaeDraftMissingOriginContent?.validationIssues?.some(
        (issue) => issue.code === "missing_explicit_origin",
      ),
    );
    assert.equal(namhaeDraftMissingOriginContent?.title, "남해 1박 2일 일정 초안");
    assert.equal(namhaeDraftMissingOriginContent?.timeline?.[0]?.title, "출발지 확인 필요");
    assert.equal(namhaeDraftMissingOriginContent?.timeline?.[1]?.title, "남해 독일마을 이동 시작");
    assert.match(namhaeDraftMissingOriginMeta, /출발지 확인 필요/);
    assert.match(namhaeDraftMissingOriginMeta, /남해 독일마을/);
    assert.match(namhaeDraftMissingOriginMeta, /원예예술촌/);
    assert.match(namhaeDraftMissingOriginMeta, /상주은모래비치/);
    assert.doesNotMatch(namhaeDraftMissingOriginMeta, /인천공항/);
    assert.doesNotMatch(namhaeDraftMissingOriginMeta, /Namhae German Village/);

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
    const yeosuFamilyPreviewWidgetMeta = JSON.stringify(yeosuFamilyPreview._meta ?? {});

    assert.equal(yeosuFamilyPreview.isError, undefined);
    assert.equal(yeosuFamilyPreviewContent?.status, "preview_ready");
    assert.match(yeosuFamilyPreviewContent?.previewId ?? "", /^preview-/);
    assert.match(yeosuFamilyPreviewContent?.pageUrl ?? "", /\/itinerary\/preview\?data=/);
    assert.doesNotMatch(yeosuFamilyPreviewContent?.pageUrl ?? "", /#planme-preview/);
    const decodedYeosuPreviewItinerary = decodePreviewUrlItinerary(
      yeosuFamilyPreviewContent?.pageUrl ?? "",
    );

    assert.equal(decodedYeosuPreviewItinerary?.title, "여수 가족 여행 1박 2일 초안");
    assert.equal(decodedYeosuPreviewItinerary?.days[0]?.timeline[1]?.title, "아쿠아플라넷 여수 방문");
    assert.equal(yeosuFamilyPreviewContent?.title, "여수 가족 여행 1박 2일 초안");
    assert.equal(yeosuFamilyPreviewContent?.timeline?.[1]?.title, "아쿠아플라넷 여수 방문");
    assert.equal(yeosuFamilyPreviewContent?.validationIssues?.length, 0);
    assert.match(yeosuFamilyPreviewWidgetMeta, /\/itinerary\/preview\?data=/);
    assert.doesNotMatch(yeosuFamilyPreviewWidgetMeta, /#planme-preview/);

    const longNoCoordinatePreview = await client.callTool({
      name: "preview_planme_itinerary",
      arguments: {
        title: "서울 출발 양양, 부산 가족 여행 3일",
        region: "서울, 양양, 부산, 동탄",
        duration: "3일",
        summary:
          "서울에서 출발하여 양양에서 해변과 휴식을 즐기고, 부산으로 이동해 가족이 함께할 수 있는 장소를 방문한 뒤 동탄 집으로 돌아가는 3일 여행 일정입니다.",
        assumptions: ["아이 동반", "가족 여행", "짐 이동 최소화"],
        savedMinutes: 0,
        days: [
          {
            day: 1,
            label: "서울 → 양양",
            stops: [
              { name: "서울", role: "origin", caption: "서울 출발" },
              { name: "하조대 해수욕장", role: "visit", caption: "양양 대표 해변" },
              { name: "양양 숙소", role: "finalDestination", caption: "양양 지역 숙소" },
            ],
            timeline: [
              {
                time: "09:00",
                title: "서울 출발",
                description: "서울에서 양양으로 출발합니다.",
                category: "transit",
                highlight: true,
              },
              {
                time: "11:30",
                title: "하조대 해수욕장 도착",
                description: "양양의 대표 해변에서 가족과 휴식 및 산책을 즐깁니다.",
                category: "event",
                highlight: true,
              },
              {
                time: "17:00",
                title: "양양 숙소 체크인",
                description: "양양 숙소에 체크인 후 휴식합니다.",
                category: "hotel",
              },
            ],
          },
          {
            day: 2,
            label: "양양 → 부산",
            stops: [
              { name: "양양 숙소", role: "origin", caption: "숙소 출발" },
              {
                name: "부산 해운대 해수욕장",
                role: "visit",
                caption: "가족과 함께 부산의 대표 해변 방문",
              },
              {
                name: "부산 영화의 전당",
                role: "visit",
                caption: "가족과 문화 체험 가능 장소 방문",
              },
              { name: "부산 숙소", role: "finalDestination", caption: "부산 지역 숙소" },
            ],
            timeline: [
              {
                time: "08:30",
                title: "양양 숙소 출발",
                description: "양양 숙소에서 부산으로 출발합니다.",
                category: "transit",
                highlight: true,
              },
              {
                time: "13:30",
                title: "해운대 해수욕장 도착",
                description: "부산의 대표 해변에서 가족과 산책 및 휴식합니다.",
                category: "event",
                highlight: true,
              },
              {
                time: "15:30",
                title: "영화의 전당 방문",
                description: "부산 영화의 전당에서 가족과 문화 체험을 합니다.",
                category: "event",
              },
              {
                time: "18:00",
                title: "부산 숙소 체크인",
                description: "부산 숙소에 체크인 후 휴식합니다.",
                category: "hotel",
              },
            ],
          },
        ],
      },
    });
    const longNoCoordinatePreviewContent =
      longNoCoordinatePreview.structuredContent as DraftPreviewContent | undefined;
    const decodedLongPreviewItinerary = decodePreviewUrlItinerary(
      longNoCoordinatePreviewContent?.pageUrl ?? "",
    );

    assert.equal(longNoCoordinatePreview.isError, undefined);
    assert.equal(longNoCoordinatePreviewContent?.status, "preview_ready");
    assert.ok(
      (longNoCoordinatePreviewContent?.pageUrl.length ?? Number.POSITIVE_INFINITY) < 2500,
      "Expected preview page URL to stay short enough for ChatGPT link handoff",
    );
    assert.equal(decodedLongPreviewItinerary?.title, "서울 출발 양양, 부산 가족 여행 3일");

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
