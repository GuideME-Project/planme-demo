import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createAiRecommendedItineraryResponse,
  createGeneratedItinerary,
  createPlanmeDraftPreview,
  generatePlanmeDraftWithOpenAi,
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
 * Verifies the OpenAI generator boundary without calling the real OpenAI API.
 */
async function assertOpenAiGeneratorContract(): Promise<void> {
  let capturedBody = "";
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      destination: "남해 가족여행",
      durationDays: 2,
      origin: "동탄",
      accommodationCandidates: [
        {
          id: "place-namhae-pension",
          name: "펜션 사랑가",
          address: "경상남도 남해군 남면 남면로 123",
          coordinate: { lat: 34.7601, lng: 127.9001 },
          placeId: "places/namhae-pension",
          types: ["lodging"],
        },
      ],
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
  assert.match(capturedBody, /역\/터미널\/공항은 기본 수하물 보관·수령지가 아닙니다/);
  assert.match(capturedBody, /luggageDestination/);
  assert.match(capturedBody, /펜션 사랑가/);
  assert.match(capturedBody, /아래 숙소 후보 중 하나/);
  assert.match(capturedBody, /PLANME_OPENAI_MODEL|test-model/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
}

/**
 * Verifies that AI generation uses actual accommodation candidates instead of generic lodging names.
 */
async function assertAccommodationCandidateContract(): Promise<void> {
  let searchCallCount = 0;
  let generatorInput = "";
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "남해",
      durationDays: 2,
      preferences: ["가족 여행", "아이 동반"],
      travelerCount: 4,
      luggageCount: 2,
    },
    {
      accommodationCandidateSearcher: async (input) => {
        searchCallCount += 1;
        assert.equal(input.destination, "남해");

        return [
          {
            id: "place-namhae-pension",
            name: "펜션 사랑가",
            address: "경상남도 남해군 남면 남면로 123",
            coordinate: { lat: 34.7601, lng: 127.9001 },
            placeId: "places/namhae-pension",
            types: ["lodging"],
          },
        ];
      },
      aiItineraryGenerator: async (input) => {
        generatorInput = JSON.stringify(input);

        return {
          title: "남해 2일 가족 여행 일정",
          region: "남해",
          duration: "2일",
          summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
          assumptions: ["숙소 후보를 사용"],
          savedMinutes: 60,
          days: [
            {
              day: 1,
              label: "Day 1",
              standardDurationMinutes: 420,
              carrymeDurationMinutes: 360,
              standardRouteText: "남해 숙소 → 상주은모래비치 → 독일마을 → 남해 숙소",
              carrymeRouteText: "상주은모래비치 → 독일마을 → 남해 숙소",
              stops: [
                { name: "남해 숙소", role: "luggageDestination", caption: "짐 도착" },
                { name: "상주은모래비치", role: "visit", caption: "해변 산책" },
                { name: "독일마을", role: "visit", caption: "관광" },
                { name: "남해 숙소", role: "finalDestination", caption: "휴식" },
              ],
              timeline: [
                {
                  time: "오전",
                  title: "남해 숙소 도착",
                  description: "숙소에 짐을 맡기고 여행을 시작합니다.",
                  category: "arrival",
                  highlight: false,
                  savingLabel: "",
                },
                {
                  time: "오후",
                  title: "상주은모래비치 방문",
                  description: "아이와 함께 바다를 봅니다.",
                  category: "event",
                  highlight: true,
                  savingLabel: "약 60분 절약",
                },
              ],
            },
          ],
        };
      },
    },
  );
  const firstStandardStop = response.itinerary.days[0]?.standard.stops[0];
  const renderedPayload = JSON.stringify(response.itinerary);

  assert.equal(searchCallCount, 1);
  assert.match(generatorInput, /펜션 사랑가/);
  assert.equal(firstStandardStop?.label, "펜션 사랑가");
  assert.deepEqual(firstStandardStop?.coordinate, { lat: 34.7601, lng: 127.9001 });
  assert.match(renderedPayload, /펜션 사랑가/);
  assert.doesNotMatch(renderedPayload, /남해 숙소/);
}

/**
 * Verifies generated detail URLs stay readable without repeating region tokens.
 */
function assertDraftPreviewSlugContract(): void {
  const preview = createPlanmeDraftPreview({
    title: "남해 2일 가족 여행",
    region: "경상남도 남해",
    duration: "2일",
    summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
    days: [
      {
        day: 1,
        label: "Day 1",
        stops: [
          { name: "남해 숙소", role: "origin", caption: "출발" },
          { name: "상주은모래비치", role: "visit", caption: "해변" },
          { name: "독일마을", role: "visit", caption: "관광" },
        ],
        timeline: [
          {
            time: "09:00",
            title: "남해 숙소 출발",
            description: "가족 여행을 시작합니다.",
            category: "arrival",
          },
          {
            time: "11:00",
            title: "상주은모래비치 산책",
            description: "아이와 함께 바다를 봅니다.",
            category: "event",
          },
        ],
      },
    ],
  });

  assert.match(preview.previewId, /^generated-경상남도-남해-2일-가족-여행-2d-/);
  assert.doesNotMatch(preview.previewId, /남해-남해/);
}

/**
 * Verifies that plain train or subway stations are not rendered as CarryME luggage handoff points.
 */
function assertStationLuggageGuardrail(): void {
  const problematicDraft = createPlanmeDraftPreview({
    title: "부산 가족 여행 1박 2일 초안",
    region: "부산",
    duration: "1박 2일",
    summary: "부산역 도착 후 감천문화마을을 보는 초안입니다.",
    origin: "서울역",
    assumptions: ["서울역 출발", "부산역은 교통 거점"],
    savedMinutes: 60,
    days: [
      {
        day: 1,
        label: "Day 1",
        standardDurationMinutes: 600,
        carrymeDurationMinutes: 540,
        standardRouteText: "서울역 → 부산역 → 감천문화마을 → 부산역 인근 숙소",
        carrymeRouteText: "서울역 → 부산역 → 감천문화마을 → 부산역 인근 숙소",
        stops: [
          { name: "서울역", role: "origin", caption: "출발" },
          { name: "부산역", role: "luggageDestination", caption: "짐 보관" },
          { name: "감천문화마을", role: "visit", caption: "관광" },
          { name: "부산역 인근 숙소", role: "finalDestination", caption: "체크인" },
        ],
        timeline: [
          {
            time: "07:00",
            title: "서울역 출발",
            description: "서울에서 부산으로 이동합니다.",
            category: "arrival",
          },
          {
            time: "11:00",
            title: "부산역 도착",
            description: "부산역 도착 후 짐 보관 및 관광 준비",
            category: "transit",
          },
          {
            time: "12:00",
            title: "감천문화마을 방문",
            description: "부산의 대표 문화마을을 둘러봅니다.",
            category: "event",
            savingLabel: "약 60분 절약",
          },
          {
            time: "17:00",
            title: "부산역 복귀 및 짐 회수",
            description: "부산역에서 짐을 챙기고 숙소 체크인을 준비합니다.",
            category: "hotel",
          },
          {
            time: "18:00",
            title: "부산역 이동",
            description: "부산역에서 짐을 챙기고 기차 탑승을 준비합니다.",
            category: "transit",
          },
        ],
      },
    ],
  });
  const renderedPayload = JSON.stringify(problematicDraft.itinerary);

  assert.equal(problematicDraft.status, "preview_ready");
  assert.match(renderedPayload, /부산 숙소/);
  assert.doesNotMatch(renderedPayload, /부산역[^"]*(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)/);
  assert.doesNotMatch(renderedPayload, /(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)[^"]*부산역/);

  const generatedBusan = createGeneratedItinerary({
    destination: "부산",
    durationDays: 2,
    origin: "서울역",
    preferences: ["감천문화마을"],
  });
  const generatedPayload = JSON.stringify(generatedBusan);

  assert.doesNotMatch(generatedPayload, /부산역[^"]*(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)/);
  assert.doesNotMatch(generatedPayload, /(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)[^"]*부산역/);
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
  await assertAccommodationCandidateContract();
  assertDraftPreviewSlugContract();
  assertStationLuggageGuardrail();

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
      /\/itinerary\/generated-/,
    );
    assert.doesNotMatch(namhaeDraftRecommendationContent?.pageUrl ?? "", /\/itinerary\/preview\?data=/);
    assert.doesNotMatch(namhaeDraftRecommendationContent?.pageUrl ?? "", /#planme-preview/);
    assert.equal(new URL(namhaeDraftRecommendationContent?.pageUrl ?? "").search, "");
    assert.match(namhaeDraftRecommendationContent?.previewId ?? "", /^generated-/);
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
    assert.match(namhaeDraftWidgetMeta, /\/itinerary\/generated-/);
    assert.doesNotMatch(namhaeDraftWidgetMeta, /\/itinerary\/preview\?data=/);
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
    assert.match(yeosuFamilyPreviewContent?.previewId ?? "", /^generated-/);
    assert.match(yeosuFamilyPreviewContent?.pageUrl ?? "", /\/itinerary\/generated-/);
    assert.doesNotMatch(yeosuFamilyPreviewContent?.pageUrl ?? "", /\/itinerary\/preview\?data=/);
    assert.doesNotMatch(yeosuFamilyPreviewContent?.pageUrl ?? "", /#planme-preview/);
    assert.equal(new URL(yeosuFamilyPreviewContent?.pageUrl ?? "").search, "");
    assert.equal(yeosuFamilyPreviewContent?.title, "여수 가족 여행 1박 2일 초안");
    assert.equal(yeosuFamilyPreviewContent?.timeline?.[1]?.title, "아쿠아플라넷 여수 방문");
    assert.equal(yeosuFamilyPreviewContent?.validationIssues?.length, 0);
    assert.match(yeosuFamilyPreviewWidgetMeta, /\/itinerary\/generated-/);
    assert.doesNotMatch(yeosuFamilyPreviewWidgetMeta, /\/itinerary\/preview\?data=/);
    assert.doesNotMatch(yeosuFamilyPreviewWidgetMeta, /#planme-preview/);

    const yeosuFamilyPreviewReadback = await client.callTool({
      name: "get_planme_itinerary",
      arguments: {
        itineraryId: yeosuFamilyPreviewContent?.previewId,
      },
    });
    const yeosuFamilyPreviewReadbackContent =
      yeosuFamilyPreviewReadback.structuredContent as DraftPreviewContent | undefined;

    assert.equal(yeosuFamilyPreviewReadback.isError, undefined);
    assert.equal(yeosuFamilyPreviewReadbackContent?.title, "여수 가족 여행 1박 2일 초안");
    assert.equal(
      yeosuFamilyPreviewReadbackContent?.timeline?.[1]?.title,
      "아쿠아플라넷 여수 방문",
    );

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
