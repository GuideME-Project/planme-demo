import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const webRoot = join(root, "apps/web");

const requiredFiles = [
  "app/api/gpt/itineraries/[itineraryId]/route.ts",
  "app/api/gpt/itineraries/[itineraryId]/share/route.ts",
  "app/api/gpt/itineraries/preview-store/route.ts",
  "app/api/gpt/openapi/route.ts",
  "app/og/itinerary/[itineraryId]/route.tsx",
];

const requiredOpenApiPaths = [
  "/api/gpt/itineraries/{itineraryId}",
  "/api/gpt/itineraries/{itineraryId}/share",
];

const forbiddenOpenApiPaths = ["/api/gpt/itineraries/recommend"];

const forbiddenFiles = [
  "apps/web/app/api/gpt/itineraries/recommend/route.ts",
  "apps/web/app/itinerary/preview/page.tsx",
  "packages/planme-core/src/preview-payload.ts",
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(webRoot, file))) {
    failures.push(`Missing GPT Actions route: apps/web/${file}`);
  }
}

const openApiFile = join(webRoot, "app/api/gpt/openapi/route.ts");
const routeMapFile = join(webRoot, "components/itinerary/RouteMap.tsx");

if (existsSync(openApiFile)) {
  const openApiSource = readFileSync(openApiFile, "utf8");

  for (const routePath of requiredOpenApiPaths) {
    if (!openApiSource.includes(routePath)) {
      failures.push(`OpenAPI schema does not expose ${routePath}`);
    }
  }

  for (const routePath of forbiddenOpenApiPaths) {
    if (openApiSource.includes(routePath)) {
      failures.push(`OpenAPI schema must not expose web generation route ${routePath}`);
    }
  }

  if (!openApiSource.includes("operationId")) {
    failures.push("OpenAPI schema must define operationId values for Custom GPT Actions");
  }

  if (!openApiSource.includes("ogImageUrl")) {
    failures.push("OpenAPI schema must expose ogImageUrl as optional preview metadata");
  }

  if (!openApiSource.includes("previewMarkdown")) {
    failures.push("OpenAPI schema must expose previewMarkdown as optional preview metadata");
  }

  if (!openApiSource.includes(".png")) {
    failures.push("OpenAPI schema must document .png preview image URLs for optional preview metadata");
  }
}

if (existsSync(routeMapFile)) {
  const routeMapSource = readFileSync(routeMapFile, "utf8");

  if (!routeMapSource.includes("addRouteSegment(route.geoPath, color, routeStyle);")) {
    failures.push("RouteMap must render route.geoPath when geoSegments are unavailable");
  }
}

const gptActionsFile = join(root, "packages/planme-core/src/gpt-actions.ts");

if (existsSync(gptActionsFile)) {
  const gptActionsSource = readFileSync(gptActionsFile, "utf8");

  if (gptActionsSource.includes("buildPlanmePreviewPageUrl")) {
    failures.push("GPT Actions must not build compressed /itinerary/preview URLs");
  }

  if (gptActionsSource.includes("PLANME_PREVIEW_DATA_PARAM")) {
    failures.push("GPT Actions must not expose preview data query parameters");
  }
}

for (const file of forbiddenFiles) {
  if (existsSync(join(root, file))) {
    failures.push(`Legacy compressed preview URL file must be removed: ${file}`);
  }
}

const coreIndexFile = join(root, "packages/planme-core/src/index.ts");

if (existsSync(coreIndexFile)) {
  const coreIndexSource = readFileSync(coreIndexFile, "utf8");

  if (coreIndexSource.includes("preview-payload")) {
    failures.push("Core package must not export legacy compressed preview payload helpers");
  }
}

const legacyPlanRouteFile = join(webRoot, "app/api/plan/route.ts");

if (existsSync(legacyPlanRouteFile)) {
  const legacyPlanRouteSource = readFileSync(legacyPlanRouteFile, "utf8");

  if (legacyPlanRouteSource.includes("export async function POST")) {
    failures.push("Legacy /api/plan route must not expose a POST generator.");
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  exit(1);
}

console.log("PlanME GPT Actions contract looks valid.");
