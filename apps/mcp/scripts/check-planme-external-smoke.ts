import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  GptActionItineraryDaySummary,
  PlanmeItinerary,
  RouteStop,
  TimelineEvent,
} from "@planme/core";
import { createPlanmeHttpServer } from "../src/server.js";

type SmokeContent = {
  clarificationContext?: {
    previousAnswers: string[];
    previousQuestions: string[];
    round: number;
    unresolvedPlaces: string[];
  };
  pageUrl?: string;
  carrymeTotalMinutes?: number;
  days?: GptActionItineraryDaySummary[];
  itineraryId?: string;
  questions?: string[];
  savedMinutes?: number;
  savingStatus?: "verified" | "hidden_estimated";
  standardTotalMinutes?: number;
  status?: "ready" | "needs_clarification";
  title?: string;
  traceId?: string;
  transportMode?: "drive" | "transit";
  unresolvedStops?: string[];
};

type StoredItineraryPayload = SmokeContent & {
  itinerary?: PlanmeItinerary;
  revision?: number;
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
  transportMode: "drive" | "transit";
};

const usageEstimate = [
  ["OpenAI", "약 1~4건"],
  ["Google Places", "0건"],
  ["Naver", "약 2~15건"],
  ["ODsay", "보통 약 5~30건, 절대 상한 60건"],
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

    const startedAt = Date.now();
    const payload = await callRecommendUntilReady(client);
    const elapsedMs = Date.now() - startedAt;

    assertCompletionContract(payload.structuredContent);
    assert.ok(
      elapsedMs < 55_000,
      `일정 생성 전체 제한 55초를 넘었습니다. elapsedMs=${elapsedMs}`,
    );

    assert.ok(payload.structuredContent?.pageUrl, "ready 응답에 pageUrl이 없습니다.");
    assert.ok(
      payload.structuredContent.pageUrl.startsWith(`${getPlanmeWebOrigin()}/itinerary/`),
      `pageUrl origin이 PLANME_WEB_ORIGIN과 다릅니다: ${payload.structuredContent.pageUrl}`,
    );

    const pageResponse = await fetch(payload.structuredContent.pageUrl);

    assert.ok(pageResponse.ok, `생성된 pageUrl이 열리지 않습니다. status=${pageResponse.status}`);
    await assertStoredItineraryMatchesSummary(payload.structuredContent);

    console.log("PlanME external MCP smoke passed.");
    console.log(`pageUrl=${payload.structuredContent.pageUrl}`);
    console.log(`traceId=${payload.structuredContent.traceId ?? "missing"}`);
    console.log(`elapsedMs=${elapsedMs}`);
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
  const baseArguments = createSmokeArguments();
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

    if (isCompletionScenario()) {
      throw new Error(
        `완료 기준 시나리오가 사용자 확인을 요구했습니다: ${payload.structuredContent.questions?.join(" / ") ?? "질문 없음"}`,
      );
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

/** Selects the explicit real-provider scenario without changing the default legacy smoke. */
function createSmokeArguments(): SmokeToolArguments {
  const completionCases: Record<string, SmokeToolArguments> = {
    "dongtan-busan-drive": createCompletionArguments("동탄", "부산", 2, "drive"),
    "dongtan-busan-transit": createCompletionArguments("동탄", "부산", 2, "transit"),
    "mapo-namhae-drive": createCompletionArguments("마포구청", "남해", 2, "drive"),
    "mapo-namhae-transit": createCompletionArguments("마포구청", "남해", 2, "transit"),
    "gangdong-yangyang-drive": createCompletionArguments("강동역", "양양", 3, "drive"),
    "gangdong-yangyang-transit": createCompletionArguments("강동역", "양양", 3, "transit"),
  };
  const selected = process.env.PLANME_EXTERNAL_SMOKE_CASE ?? "";

  if (completionCases[selected]) {
    return completionCases[selected];
  }

  if (process.env.PLANME_EXTERNAL_SMOKE_CASE === "namhae-transit") {
    return {
      destination: "남해",
      durationDays: 2,
      luggageCount: 1,
      origin: "동탄호수공원",
      preferences: ["남해 핵심 명소", "대중교통 이동", "무리 없는 동선"],
      transportMode: "transit",
      travelerCount: 1,
    };
  }

  return {
    destination: "경상남도 거제시",
    durationDays: 3,
    luggageCount: 2,
    origin: "강원도 양양",
    preferences: ["낚시", "바다전망 숙소"],
    transportMode: "drive",
    travelerCount: 2,
  };
}

function createCompletionArguments(
  origin: string,
  destination: string,
  durationDays: number,
  transportMode: "drive" | "transit",
): SmokeToolArguments {
  return {
    destination,
    durationDays,
    luggageCount: 1,
    origin,
    preferences: [],
    transportMode,
    travelerCount: 1,
  };
}

function isCompletionScenario() {
  return /^(dongtan-busan|mapo-namhae|gangdong-yangyang)-(drive|transit)$/.test(
    process.env.PLANME_EXTERNAL_SMOKE_CASE ?? "",
  );
}

/** Verifies the server-owned multi-day and luggage contract before browser testing. */
function assertCompletionContract(content: SmokeContent | undefined) {
  if (!isCompletionScenario()) {
    return;
  }

  assert.equal(content?.status, "ready");
  assert.match(content?.traceId ?? "", /^[0-9a-f-]{36}$/i);
  const expectedInput = createSmokeArguments();
  const expectedDayCount = expectedInput.durationDays;

  assert.equal(content?.transportMode, expectedInput.transportMode);
  assert.equal(content?.days?.length, expectedDayCount);
  const days = content?.days ?? [];
  const tripOrigin = days[0]?.standard.start;

  assert.ok(tripOrigin, "첫날 출발지 요약이 없습니다.");

  days.forEach((day, dayIndex) => {
    assert.equal(day.day, dayIndex + 1);
    assert.equal(day.isFinalDay, dayIndex === days.length - 1);
    assert.equal(day.returnsToTripOrigin, dayIndex === days.length - 1);
    assert.equal(day.sameEndpoints, true);
    assert.equal(day.standard.start, day.carryme.start);
    assert.equal(day.standard.end, day.carryme.end);
    assert.ok(day.standard.durationMinutes > 0, `${day.day}일차 Standard 이동시간이 없습니다.`);
    assert.ok(day.carryme.durationMinutes > 0, `${day.day}일차 CarryME 이동시간이 없습니다.`);
    const requiresLuggageDelivery = day.isFinalDay || day.standard.start !== day.standard.end;

    if (requiresLuggageDelivery) {
      assert.ok(day.luggageDelivery, `${day.day}일차 짐 배송 요약이 없습니다.`);
      assert.equal(
        day.luggageDelivery?.targetRole,
        day.isFinalDay ? "복귀지" : "숙소",
      );
      assert.equal(
        day.luggageDelivery?.target,
        day.standard.end,
        `${day.day}일차 짐 목적지가 여행자 종료지와 다릅니다.`,
      );

      const departure = parseSmokeTime(day.carryme.startTime);
      const delivery = parseSmokeTime(day.luggageDelivery?.time);
      const arrival = parseSmokeTime(day.carryme.endTime);

      assert.ok(delivery > departure, `${day.day}일차 짐이 출발 전에 도착했습니다.`);
      assert.ok(delivery <= arrival, `${day.day}일차 짐이 여행자보다 늦게 도착했습니다.`);
    } else {
      assert.equal(
        day.luggageDelivery,
        undefined,
        `${day.day}일차 같은 숙소 연박에 중복 짐 배송이 있습니다.`,
      );
    }

    if (dayIndex > 0) {
      assert.equal(day.standard.start, days[dayIndex - 1]?.standard.end);
      assert.equal(day.carryme.start, days[dayIndex - 1]?.carryme.end);
    }
  });

  assert.equal(days.at(-1)?.isFinalDay, true);
  assert.equal(days.at(-1)?.returnsToTripOrigin, true);
  assert.equal(days.at(-1)?.standard.end, tripOrigin);
  assert.equal(days.at(-1)?.carryme.end, tripOrigin);
  assert.equal(days.at(-1)?.luggageDelivery?.target, tripOrigin);

  assert.equal(
    content?.standardTotalMinutes,
    days.reduce((sum, day) => sum + day.standard.durationMinutes, 0),
  );
  assert.equal(
    content?.carrymeTotalMinutes,
    days.reduce((sum, day) => sum + day.carryme.durationMinutes, 0),
  );

  if (content?.savingStatus === "verified") {
    assert.equal(
      content.savedMinutes,
      Math.max(0, (content.standardTotalMinutes ?? 0) - (content.carrymeTotalMinutes ?? 0)),
    );
  } else {
    assert.equal(content?.savingStatus, "hidden_estimated");
    assert.equal(content?.savedMinutes, undefined);
  }
}

/** Verifies that the model-visible summary and saved detail API expose one identical itinerary. */
async function assertStoredItineraryMatchesSummary(content: SmokeContent): Promise<void> {
  if (!isCompletionScenario()) {
    return;
  }

  assert.ok(content.pageUrl, "저장 일정 비교에 필요한 pageUrl이 없습니다.");
  assert.ok(content.itineraryId, "저장 일정 비교에 필요한 itineraryId가 없습니다.");
  const pageUrl = new URL(content.pageUrl);
  const detailApiUrl = new URL(
    `/api/gpt/itineraries/${encodeURIComponent(content.itineraryId)}`,
    pageUrl.origin,
  );
  const detailResponse = await fetch(detailApiUrl);

  assert.ok(
    detailResponse.ok,
    `저장된 상세 API를 열 수 없습니다. status=${detailResponse.status}`,
  );
  const stored = (await detailResponse.json()) as StoredItineraryPayload;

  assert.equal(stored.status, "ready");
  assert.equal(stored.itineraryId, content.itineraryId);
  assert.equal(
    new URL(stored.pageUrl ?? "", pageUrl.origin).pathname,
    pageUrl.pathname,
  );
  assert.equal(stored.standardTotalMinutes, content.standardTotalMinutes);
  assert.equal(stored.carrymeTotalMinutes, content.carrymeTotalMinutes);
  assert.equal(stored.savingStatus, content.savingStatus);
  assert.equal(stored.savedMinutes, content.savedMinutes);
  assert.deepEqual(stored.days, content.days);
  assert.ok(stored.itinerary, "저장된 상세 API에 전체 일정이 없습니다.");
  assert.equal(stored.itinerary.transportMode, content.transportMode);
  assertDetailedItineraryContract(stored.itinerary, createSmokeArguments());
}

/** Verifies physical place references, multi-day boundaries, shipment timing, and mode consistency. */
function assertDetailedItineraryContract(
  itinerary: PlanmeItinerary,
  expectedInput: SmokeToolArguments,
): void {
  assert.equal(itinerary.transportMode, expectedInput.transportMode);
  assert.equal(itinerary.days.length, expectedInput.durationDays);
  const tripOrigin = itinerary.days[0]?.standard.stops[0];

  assert.ok(tripOrigin, "저장 일정의 최초 출발지가 없습니다.");
  assert.equal(tripOrigin.role, "출발지");
  assert.equal(tripOrigin.placeConstraint, "fixed");
  assert.ok(tripOrigin.coordinate, "최초 출발지 좌표가 없습니다.");
  assert.ok(tripOrigin.placeRef, "최초 출발지 장소 참조가 없습니다.");
  assert.ok(
    itinerary.region.includes(expectedInput.destination) ||
      itinerary.title.includes(expectedInput.destination),
    "저장 일정이 사용자가 지정한 목적 지역을 유지하지 않았습니다.",
  );

  if (expectedInput.origin === "동탄") {
    assert.ok(
      normalizePlaceLabel(tripOrigin.label).includes(normalizePlaceLabel(expectedInput.origin)) &&
        normalizePlaceLabel(tripOrigin.label) !== normalizePlaceLabel(expectedInput.origin),
      `범위형 출발지의 확정 위치가 화면 이름에 드러나지 않습니다: ${tripOrigin.label}`,
    );
  } else {
    assert.ok(
      normalizePlaceLabel(tripOrigin.label).includes(normalizePlaceLabel(expectedInput.origin)),
      `사용자가 지정한 출발지가 다른 장소명으로 바뀌었습니다: ${tripOrigin.label}`,
    );
  }

  itinerary.days.forEach((day, dayIndex) => {
    const isFinalDay = dayIndex === itinerary.days.length - 1;
    const standardStart = day.standard.stops[0];
    const standardEnd = day.standard.stops.at(-1);
    const carrymeStart = day.carryme.stops[0];
    const carrymeEnd = day.carryme.stops.at(-1);

    assert.ok(standardStart && standardEnd && carrymeStart && carrymeEnd);
    [...day.standard.stops, ...day.carryme.stops].forEach((stop) => {
      assert.ok(stop.coordinate, `${day.day}일차 ${stop.label} 좌표가 없습니다.`);
      assert.ok(stop.placeRef, `${day.day}일차 ${stop.label} 장소 참조가 없습니다.`);
    });
    assertSamePhysicalStop(standardStart, carrymeStart, `${day.day}일차 출발지`);
    assertSamePhysicalStop(standardEnd, carrymeEnd, `${day.day}일차 종료지`);
    assert.ok(
      day.standard.stops.some((stop) => stop.role === "방문지"),
      `${day.day}일차 Standard 방문지가 없습니다.`,
    );
    assert.ok(
      day.carryme.stops.some((stop) => stop.role === "방문지"),
      `${day.day}일차 CarryME 방문지가 없습니다.`,
    );
    assertRouteMode(day.standard.stops, day.standardTimeline ?? [], expectedInput.transportMode);
    assertRouteMode(day.carryme.stops, day.carrymeTimeline ?? day.timeline, expectedInput.transportMode);
    assertChronologicalTimeline(day.standardTimeline ?? day.timeline, `${day.day}일차 Standard`);
    assertChronologicalTimeline(day.carrymeTimeline ?? day.timeline, `${day.day}일차 CarryME`);
    assertTimelineUsesCanonicalStopLabels(
      day.standard.stops,
      day.standardTimeline ?? day.timeline,
      `${day.day}일차 Standard`,
    );
    assertTimelineUsesCanonicalStopLabels(
      day.carryme.stops,
      day.carrymeTimeline ?? day.timeline,
      `${day.day}일차 CarryME`,
    );

    if (isFinalDay) {
      assertSamePhysicalStop(standardEnd, tripOrigin, "마지막 날 Standard 최초 출발지 복귀");
      assertSamePhysicalStop(carrymeEnd, tripOrigin, "마지막 날 CarryME 최초 출발지 복귀");
      assert.equal(standardEnd.role, "복귀지");
      assert.equal(carrymeEnd.role, "복귀지");
      assert.equal(
        day.standard.stops.slice(1).some((stop) => stop.role === "숙소"),
        false,
        "마지막 날 Standard가 숙소에 다시 복귀했습니다.",
      );
      assert.equal(
        day.carryme.stops.slice(1).some((stop) => stop.role === "숙소"),
        false,
        "마지막 날 CarryME가 숙소에 다시 복귀했습니다.",
      );
    } else {
      assert.equal(standardEnd.role, "숙소");
      assert.equal(carrymeEnd.role, "숙소");
      assertStandardLodgingDetour(day.standard.stops, day.carryme.stops);
      const nextDay = itinerary.days[dayIndex + 1];

      assert.ok(nextDay, `${day.day + 1}일차 일정이 없습니다.`);
      assertSamePhysicalStop(
        nextDay.standard.stops[0],
        standardEnd,
        `${day.day + 1}일차 Standard 숙소 출발`,
      );
      assertSamePhysicalStop(
        nextDay.carryme.stops[0],
        carrymeEnd,
        `${day.day + 1}일차 CarryME 숙소 출발`,
      );
    }

    const requiresLuggageDelivery =
      physicalStopKey(standardStart) !== physicalStopKey(standardEnd);

    if (requiresLuggageDelivery) {
      assertDetailedLuggageDelivery(day, isFinalDay ? tripOrigin : standardEnd);
    } else {
      assert.equal(
        (day.carrymeTimeline ?? day.timeline).filter(
          (event) => event.eventKind === "luggage_delivery",
        ).length,
        0,
        `${day.day}일차 같은 숙소 연박에 중복 짐 배송이 있습니다.`,
      );
    }
  });
}

/** Verifies that Standard alone detours to a new lodging before returning there. */
function assertStandardLodgingDetour(
  standardStops: RouteStop[],
  carrymeStops: RouteStop[],
): void {
  const lodging = standardStops.at(-1);
  const standardStart = standardStops[0];

  assert.ok(lodging && standardStart);

  if (physicalStopKey(lodging) === physicalStopKey(standardStart)) {
    return;
  }

  const firstVisitIndex = standardStops.findIndex((stop) => stop.role === "방문지");
  const lodgingDetourIndex = standardStops
    .slice(1, -1)
    .findIndex((stop) => physicalStopKey(stop) === physicalStopKey(lodging));

  assert.ok(firstVisitIndex > 0, "Standard 관광 방문 순서를 확인할 수 없습니다.");
  assert.ok(
    lodgingDetourIndex >= 0,
    "Standard가 관광 전에 새 숙소를 경유하지 않았습니다.",
  );
  assert.ok(
    lodgingDetourIndex + 1 < firstVisitIndex,
    "Standard의 새 숙소 경유가 첫 관광지보다 늦습니다.",
  );
  assert.equal(
    carrymeStops.slice(1, -1).some((stop) => physicalStopKey(stop) === physicalStopKey(lodging)),
    false,
    "CarryME 여행자 경로에 짐 배송 숙소가 중간 경유지로 들어갔습니다.",
  );
}

/** Verifies one non-traveler shipment with stable source/target references and valid timing. */
function assertDetailedLuggageDelivery(
  day: PlanmeItinerary["days"][number],
  expectedTarget: RouteStop,
): void {
  const timeline = day.carrymeTimeline ?? day.timeline;
  const deliveries = timeline.filter((event) => event.eventKind === "luggage_delivery");

  assert.equal(deliveries.length, 1, `${day.day}일차 짐 배송 이벤트 수가 1개가 아닙니다.`);
  const delivery = deliveries[0];
  const source = day.carryme.stops[0];

  assert.ok(delivery && source);
  assert.equal(delivery.stopRef, undefined, "짐 배송이 여행자 정차지로 연결됐습니다.");
  assert.equal(delivery.deliverySourcePlaceRef, source.placeRef);
  assert.equal(delivery.deliveryTargetPlaceRef, expectedTarget.placeRef);
  assert.ok(delivery.deliveryTargetStopRef, "짐 배송 대상 방문 참조가 없습니다.");
  const referencedTarget = [...day.standard.stops, ...day.carryme.stops].find(
    (stop) => stop.stopRef === delivery.deliveryTargetStopRef,
  );

  assertSamePhysicalStop(referencedTarget, expectedTarget, `${day.day}일차 짐 배송 대상`);

  const departure = findTravelerEvent(timeline, source);
  const arrival = timeline.find(
    (event) =>
      event.eventKind !== "luggage_delivery" &&
      event.stopRef === delivery.deliveryTargetStopRef,
  );
  const standardTargetArrival = (day.standardTimeline ?? day.timeline).find(
    (event) =>
      event.eventKind !== "luggage_delivery" &&
      event.stopRef === delivery.deliveryTargetStopRef,
  );

  assert.ok(departure, `${day.day}일차 CarryME 출발 이벤트가 없습니다.`);
  assert.ok(arrival, `${day.day}일차 CarryME 배송 대상 도착 이벤트가 없습니다.`);
  assert.ok(standardTargetArrival, `${day.day}일차 Standard 배송 기준 도착 이벤트가 없습니다.`);
  assert.equal(
    delivery.time,
    standardTargetArrival.time,
    `${day.day}일차 짐 도착 시각이 Standard의 실제 목적지 도착 시각과 다릅니다.`,
  );
  assert.ok(parseSmokeTime(delivery.time) > parseSmokeTime(departure.time));
  assert.ok(parseSmokeTime(delivery.time) <= parseSmokeTime(arrival.time));
}

function findTravelerEvent(timeline: TimelineEvent[], stop: RouteStop) {
  return timeline.find(
    (event) => event.eventKind !== "luggage_delivery" && event.stopRef === stop.stopRef,
  );
}

function assertRouteMode(
  stops: RouteStop[],
  timeline: TimelineEvent[],
  expectedMode: "drive" | "transit",
) {
  stops.forEach((stop) => assert.equal(stop.mode, expectedMode));
  timeline.forEach((event) => {
    if (event.eventKind === "luggage_delivery") {
      assert.equal(event.movementMode, undefined);
    } else {
      assert.equal(event.movementMode, expectedMode);
    }
  });
}

function assertChronologicalTimeline(timeline: TimelineEvent[], label: string) {
  timeline.slice(1).forEach((event, index) => {
    assert.ok(
      parseSmokeTime(event.time) >= parseSmokeTime(timeline[index]?.time),
      `${label} 시간표가 역행했습니다.`,
    );
  });
}

/** Verifies that persisted traveler events use the resolved stop label without AI prefix repetition. */
function assertTimelineUsesCanonicalStopLabels(
  stops: RouteStop[],
  timeline: TimelineEvent[],
  label: string,
) {
  timeline.forEach((event) => {
    if (event.eventKind === "luggage_delivery" || !event.stopRef) {
      return;
    }

    const stop = stops.find((candidate) => candidate.stopRef === event.stopRef);

    assert.ok(stop, `${label} 시간표가 알 수 없는 정류장을 참조합니다: ${event.stopRef}`);
    assert.ok(
      normalizePlaceLabel(event.title).startsWith(normalizePlaceLabel(stop.label)),
      `${label} 시간표 장소명이 확정 장소와 다릅니다: ${event.title} / ${stop.label}`,
    );
  });
}

function assertSamePhysicalStop(left: RouteStop | undefined, right: RouteStop | undefined, label: string) {
  assert.ok(left && right, `${label} 장소가 없습니다.`);
  assert.equal(physicalStopKey(left), physicalStopKey(right), `${label} 장소 참조가 다릅니다.`);
}

function physicalStopKey(stop: RouteStop) {
  if (stop.placeRef) {
    return `placeRef:${stop.placeRef}`;
  }

  if (stop.placeSourceRef) {
    return `placeSourceRef:${stop.placeSourceRef}`;
  }

  if (stop.placeId) {
    return `placeId:${stop.placeId}`;
  }

  if (stop.coordinate) {
    return `coordinate:${stop.coordinate.lat.toFixed(6)}:${stop.coordinate.lng.toFixed(6)}`;
  }

  return `label:${stop.label.trim()}`;
}

function normalizePlaceLabel(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function parseSmokeTime(value: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");

  assert.ok(match, `시간 형식이 올바르지 않습니다: ${value ?? "missing"}`);
  return Number(match[1]) * 60 + Number(match[2]);
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
