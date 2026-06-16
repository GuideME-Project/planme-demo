import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, exit } from "node:process";

const root = cwd();

const requiredFiles = [
  "app/api/gpt/itineraries/recommend/route.ts",
  "app/api/gpt/itineraries/[itineraryId]/route.ts",
  "app/api/gpt/itineraries/[itineraryId]/share/route.ts",
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
  if (!existsSync(join(root, file))) {
    failures.push(`Missing GPT Actions route: ${file}`);
  }
}

const openApiFile = join(root, "app/api/gpt/openapi/route.ts");

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

if (failures.length > 0) {
  console.error(failures.join("\n"));
  exit(1);
}

console.log("PlanME GPT Actions contract looks valid.");
