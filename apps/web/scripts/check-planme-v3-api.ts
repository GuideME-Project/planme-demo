import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBrowserEditItineraryRequest,
  parseEditItineraryRequest,
  parseRunRequest,
  parseStartItineraryRequest,
} from "../lib/planme-v3/api-contracts";
import { isAuthorizedPlanmeInternalRequest } from "../lib/planme-v3/internal-auth";

const validStart = JSON.stringify({
  origin: "서울역",
  destination: "부산",
  transportMode: "transit",
  durationDays: 1,
});
assert.equal(parseStartItineraryRequest(validStart).ok, true);
assert.equal(
  parseStartItineraryRequest(
    JSON.stringify({ ...JSON.parse(validStart), hotelName: "AI가 만든 숙소" }),
  ).ok,
  false,
);
assert.equal(
  parseStartItineraryRequest(
    JSON.stringify({ ...JSON.parse(validStart), requestedPlaces: null }),
  ).ok,
  false,
);
assert.deepEqual(parseRunRequest('{"deadlineEpochMs":42000}'), {
  ok: true,
  deadlineEpochMs: 42_000,
});

const validEdit = JSON.stringify({
  baseRevision: 1,
  transportMode: "drive",
  days: [{ day: 1, orderedVisitContentIds: ["tour-content-1"] }],
});
assert.equal(parseEditItineraryRequest(validEdit).ok, true);
assert.equal(
  parseEditItineraryRequest(
    JSON.stringify({
      baseRevision: 1,
      days: [
        {
          day: 1,
          orderedVisitContentIds: ["tour-content-1"],
          coordinate: { lat: 1, lng: 2 },
        },
      ],
    }),
  ).ok,
  false,
);
assert.equal(
  parseBrowserEditItineraryRequest(
    JSON.stringify({
      token: "signed-token",
      baseRevision: 1,
      days: [{ day: 1, orderedVisitContentIds: ["tour-content-1"] }],
    }),
  ).ok,
  true,
);

const previousToken = process.env.PLANME_INTERNAL_API_TOKEN;
try {
  process.env.PLANME_INTERNAL_API_TOKEN = "constant-time-contract-token";
  assert.equal(
    isAuthorizedPlanmeInternalRequest(
      new Request("https://planme.test", {
        headers: { Authorization: "Bearer constant-time-contract-token" },
      }),
    ),
    true,
  );
  assert.equal(
    isAuthorizedPlanmeInternalRequest(
      new Request("https://planme.test", {
        headers: { Authorization: "Bearer wrong-token" },
      }),
    ),
    false,
  );
} finally {
  if (previousToken === undefined) delete process.env.PLANME_INTERNAL_API_TOKEN;
  else process.env.PLANME_INTERNAL_API_TOKEN = previousToken;
}

const root = join(import.meta.dirname, "../../..");
const v3BrowserSource = readFileSync(
  join(root, "apps/web/components/itinerary/V3ItineraryDetail.tsx"),
  "utf8",
);
assert.doesNotMatch(
  v3BrowserSource,
  /api\.odsay\.com|maps\.apigw\.ntruss\.com|routes\/finalize|NEXT_PUBLIC_ODSAY/,
);
assert.doesNotMatch(v3BrowserSource, /excludedRequestedPlaces/);
assert.match(v3BrowserSource, /contentId/);
const browserEditRouteSource = readFileSync(
  join(
    root,
    "apps/web/app/api/gpt/itineraries/[itineraryId]/edits/route.ts",
  ),
  "utf8",
);
assert.match(browserEditRouteSource, /runUntilTerminal/);
assert.match(browserEditRouteSource, /maxDuration = 45/);

const internalStartRouteSource = readFileSync(
  join(root, "apps/web/app/api/internal/planme/v3/itineraries/route.ts"),
  "utf8",
);
assert.match(internalStartRouteSource, /IDEMPOTENCY_KEY_REUSED/);
const internalEditRouteSource = readFileSync(
  join(
    root,
    "apps/web/app/api/internal/planme/v3/itineraries/[itineraryId]/edits/route.ts",
  ),
  "utf8",
);
assert.match(internalEditRouteSource, /ITINERARY_VERSION_CONFLICT/);

const mcpSources = [
  "apps/mcp/src/gpts-actions-api.ts",
  "apps/mcp/src/planme-mcp.ts",
].map((path) => readFileSync(join(root, path), "utf8")).join("\n");
assert.doesNotMatch(
  mcpSources,
  /createAiRecommendedItineraryResponse|searchPlanmePlaceCandidates|persistItineraryForDetailPage\(response/,
);
assert.match(mcpSources, /startPlanmeV3Itinerary/);
assert.match(mcpSources, /createPlanmeIdempotencyKey\("gpts", invocationId\)/);
assert.match(mcpSources, /createPlanmeIdempotencyKey\("mcp", requestId\)/);

console.log("PlanME V3 API/browser boundary checks passed (V3-09). ");
