import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "@playwright/test";

const webPort = Number(process.env.PLANME_LOCAL_WEB_PORT ?? "3011");
const mcpPort = Number(process.env.PLANME_LOCAL_MCP_PORT ?? "8791");
const webOrigin = `http://127.0.0.1:${webPort}`;
const mcpOrigin = `http://127.0.0.1:${mcpPort}`;
const internalToken = "planme-local-integration-token";
const children = [];
const outputByName = new Map();

try {
  startServer("web", "npm", [
    "--workspace",
    "@planme/web",
    "run",
    "dev",
    "--",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(webPort),
  ], {
    PLANME_INTERNAL_API_TOKEN: internalToken,
    PLANME_V3_LOCAL_FIXTURE: "1",
    PLANME_WEB_ORIGIN: webOrigin,
    UPSTASH_REDIS_REST_TOKEN: "",
    UPSTASH_REDIS_REST_URL: "",
  });
  startServer("mcp", process.execPath, [
    "--import",
    "tsx",
    "apps/mcp/src/server.ts",
  ], {
    PLANME_INTERNAL_API_TOKEN: internalToken,
    PLANME_WEB_ORIGIN: webOrigin,
    PORT: String(mcpPort),
    UPSTASH_REDIS_REST_TOKEN: "",
    UPSTASH_REDIS_REST_URL: "",
  });

  await waitForHttp(`${webOrigin}/`, 120_000);
  await waitForHttp(`${mcpOrigin}/health`, 30_000);

  const initialization = await callMcp(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "planme-local-integration", version: "1.0.0" },
  });
  assert.equal(initialization.serverInfo?.name, "planme-mcp");

  const listed = await callMcp(2, "tools/list");
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [
      "get_planme_itinerary",
      "recommend_planme_itinerary",
      "start_planme_planning",
    ],
  );

  const assessment = await callMcp(3, "tools/call", {
    name: "start_planme_planning",
    arguments: { origin: "서울역" },
  });
  assert.equal(assessment.structuredContent?.status, "needs_input");
  assert.deepEqual(assessment.structuredContent?.missingSlots, [
    "destination",
    "transportMode",
    "durationDays",
  ]);
  assert.equal(
    assessment.structuredContent?.questions.every((question) =>
      ["origin", "destination", "transportMode", "durationDays"].includes(
        question.slot,
      )
    ),
    true,
  );

  const toolArguments = {
    origin: "서울역",
    destination: "부산",
    transportMode: "transit",
    durationDays: 1,
    requestedPlaces: ["해운대", "존재하지 않는 장소"],
  };
  const requestId = `local-ready-${Date.now()}`;
  const started = await callMcp(requestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: toolArguments,
  });
  assert.equal(started.structuredContent?.status, "processing");
  assert.equal(started.structuredContent?.pageUrl, undefined);
  const itineraryId = started.structuredContent?.itineraryId;
  assert.ok(itineraryId);

  const replay = await callMcp(requestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: toolArguments,
  });
  assert.equal(replay.structuredContent?.itineraryId, itineraryId);

  const conflict = await callMcp(requestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: { ...toolArguments, destination: "경주" },
  });
  assert.equal(conflict.structuredContent?.status, "failed");
  assert.equal(
    conflict.structuredContent?.errorCode,
    "IDEMPOTENCY_KEY_REUSED",
  );

  let terminal = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = await callMcp(100 + attempt, "tools/call", {
      name: "get_planme_itinerary",
      arguments: { itineraryId },
    });
    if (result.structuredContent?.status !== "processing") {
      terminal = result.structuredContent;
      break;
    }
  }
  assert.equal(terminal?.status, "ready");
  assert.equal(terminal?.itineraryId, itineraryId);
  assert.equal(terminal?.revision, 1);
  assert.equal(terminal?.pageUrl, `${webOrigin}/itinerary/${itineraryId}`);
  assert.equal(terminal?.widget?.pageUrl, terminal?.pageUrl);
  assert.deepEqual(terminal?.excludedRequestedPlaces, [
    { input: "존재하지 않는 장소", reason: "TOURAPI_NOT_FOUND" },
  ]);

  const terminalReplay = await callMcp(200, "tools/call", {
    name: "get_planme_itinerary",
    arguments: { itineraryId },
  });
  assert.equal(terminalReplay.structuredContent?.status, "ready");
  assert.equal(terminalReplay.structuredContent?.revision, 1);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const forbiddenBrowserRequests = [];
    page.on("request", (request) => {
      const url = request.url();
      if (
        url.includes("api.odsay.com") ||
        url.includes("api.openai.com") ||
        url.includes("apis.data.go.kr") ||
        url.includes("/api/naver/directions/routes") ||
        url.includes("map-direction")
      ) {
        forbiddenBrowserRequests.push(url);
      }
    });
    const response = await page.goto(terminal.pageUrl, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 200);
    const body = await page.locator("body").innerText();
    assert.match(body, /부산 여행 일정/);
    assert.match(body, /해운대/);
    assert.match(body, /부산 호텔/);
    assert.match(body, /동선 비교/);
    assert.match(body, /상세 지도/);
    assert.match(body, /서울역 → 부산 호텔 → 해운대 → 서울역/);
    assert.match(body, /서울역 → 해운대 → 서울역/);
    assert.doesNotMatch(body, /존재하지 않는 장소/);
    assert.equal(await page.getByTestId("destination-editor").count(), 0);
    const browserTitle = await page.title();
    assert.match(browserTitle, /^부산 여행 일정/);
    assert.equal(browserTitle.startsWith("PlanME"), false);
    assert.equal(
      await page.locator('meta[property="og:title"]').getAttribute("content"),
      "부산 여행 일정",
    );
    assert.equal(
      await page.getByRole("heading", { level: 1 }).innerText(),
      "부산 여행 일정",
    );
    const standardBox = await page
      .getByText("서울역 → 부산 호텔 → 해운대 → 서울역", { exact: true })
      .boundingBox();
    const carrymeBox = await page
      .getByText("서울역 → 해운대 → 서울역", { exact: true })
      .boundingBox();
    assert.ok(standardBox);
    assert.ok(carrymeBox);
    assert.ok(Math.abs(standardBox.y - carrymeBox.y) < 1);
    assert.deepEqual(forbiddenBrowserRequests, []);
  } finally {
    await browser.close();
  }

  console.log(
    `PlanME local two-server integration passed: ${itineraryId} revision 1 ready, detail page rendered, browser provider requests 0.`,
  );
} catch (error) {
  for (const [name, output] of outputByName) {
    if (output.trim()) {
      console.error(`[${name}] ${output.slice(-4_000)}`);
    }
  }
  throw error;
} finally {
  stopServers();
}

function startServer(name, command, args, environment) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  outputByName.set(name, "");
  const capture = (chunk) => {
    const current = outputByName.get(name) ?? "";
    outputByName.set(name, `${current}${chunk}`.slice(-8_000));
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  children.push(child);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local server did not become ready: ${url}`);
}

async function callMcp(id, method, params = {}) {
  const response = await fetch(`${mcpOrigin}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${method}: ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);
  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(payload.id, id);
  assert.equal(payload.error, undefined);
  return payload.result;
}

function stopServers() {
  for (const child of children.reverse()) {
    if (!child.pid || child.killed) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
