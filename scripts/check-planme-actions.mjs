import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();
const webRoot = join(root, "apps/web");

const requiredFiles = [
  "app/api/gpt/itineraries/recommend/route.ts",
  "app/api/gpt/itineraries/[itineraryId]/route.ts",
  "app/api/gpt/itineraries/[itineraryId]/share/route.ts",
  "app/api/gpt/itineraries/preview-store/route.ts",
  "app/api/gpt/openapi/route.ts",
  "app/og/itinerary/[itineraryId]/route.tsx",
];

const requiredOpenApiPaths = [
  "/api/gpt/itineraries/recommend",
  "/api/gpt/itineraries/{itineraryId}",
  "/api/gpt/itineraries/{itineraryId}/share",
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(webRoot, file))) {
    failures.push(`Missing GPT Actions route: apps/web/${file}`);
  }
}

const openApiFile = join(webRoot, "app/api/gpt/openapi/route.ts");

if (existsSync(openApiFile)) {
  const openApiSource = readFileSync(openApiFile, "utf8");

  for (const routePath of requiredOpenApiPaths) {
    if (!openApiSource.includes(routePath)) {
      failures.push(`OpenAPI schema does not expose ${routePath}`);
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

if (failures.length > 0) {
  console.error(failures.join("\n"));
  exit(1);
}

console.log("PlanME GPT Actions contract looks valid.");
