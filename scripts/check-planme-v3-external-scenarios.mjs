import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "@playwright/test";
import * as nextEnv from "@next/env";

const loadEnvConfig = nextEnv.loadEnvConfig ?? nextEnv.default?.loadEnvConfig;
assert.equal(typeof loadEnvConfig, "function", "@next/env loadEnvConfig를 찾을 수 없습니다.");
loadEnvConfig("apps/web");

const webPort = Number(process.env.PLANME_EXTERNAL_E2E_WEB_PORT ?? "3000");
const mcpPort = Number(process.env.PLANME_EXTERNAL_E2E_MCP_PORT ?? "8793");
const webOrigin = `http://localhost:${webPort}`;
const mcpOrigin = `http://localhost:${mcpPort}`;
const internalToken = "planme-external-e2e-token";
const children = [];
const outputByName = new Map();

const allScenarios = [
  {
    id: "1-a",
    prompt: "부산역 1박 2일 여행 추천",
    destination: "부산역",
    durationDays: 2,
    origin: "동탄",
    transportInput: "자동차",
    transportMode: "drive",
  },
  {
    id: "1-b",
    prompt: "부산역 1박 2일 여행 추천",
    destination: "부산역",
    durationDays: 2,
    origin: "동탄",
    transportInput: "대중교통",
    transportMode: "transit",
  },
  {
    id: "2-a",
    prompt: "양양 2박 3일 여행 추천",
    destination: "양양",
    durationDays: 3,
    origin: "마포구청",
    transportInput: "자동차",
    transportMode: "drive",
  },
  {
    id: "2-b",
    prompt: "양양 2박 3일 여행 추천",
    destination: "양양",
    durationDays: 3,
    origin: "마포구청",
    transportInput: "대중교통",
    transportMode: "transit",
  },
];
const scenarioFilter = process.env.PLANME_EXTERNAL_E2E_SCENARIO?.trim();
const scenarios = scenarioFilter
  ? allScenarios.filter((scenario) => scenario.id === scenarioFilter)
  : allScenarios;

assert.ok(
  scenarios.length > 0,
  `알 수 없는 시나리오입니다: ${scenarioFilter}. 사용 가능: ${allScenarios.map(({ id }) => id).join(", ")}`,
);

try {
  assertExternalConfirmation();
  assertRequiredProviderConfiguration();
  assert.equal(
    process.env.PLANME_V3_LOCAL_FIXTURE?.trim() === "1",
    false,
    "PLANME_V3_LOCAL_FIXTURE=1에서는 실제 공급자 테스트를 실행할 수 없습니다.",
  );

  startServer(
    "web",
    "npm",
    [
      "--workspace",
      "@planme/web",
      "run",
      "dev",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    {
      NEXT_TELEMETRY_DISABLED: "1",
      PLANME_INTERNAL_API_TOKEN: internalToken,
      PLANME_V3_LOCAL_FIXTURE: "0",
      PLANME_V3_ROUTE_DEBUG: "1",
      PLANME_WEB_ORIGIN: webOrigin,
      UPSTASH_REDIS_REST_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "",
    },
  );
  startServer(
    "mcp",
    process.execPath,
    ["--import", "tsx", "apps/mcp/src/server.ts"],
    {
      PLANME_INTERNAL_API_TOKEN: internalToken,
      PLANME_WEB_ORIGIN: webOrigin,
      PORT: String(mcpPort),
      UPSTASH_REDIS_REST_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "",
    },
  );

  await waitForHttp(`${webOrigin}/`, 120_000);
  await waitForHttp(`${mcpOrigin}/health`, 30_000);

  const scenarioResults = [];
  for (const scenario of scenarios) {
    let conversation = applyUserTurn({}, scenario.prompt);
    const initialPlanning = await callAction("/api/gpt/planning/start", {
      message: scenario.prompt,
      ...conversation,
    });
    assertActionStatus(scenario.id, "initial planning", initialPlanning, 200);
    assert.equal(initialPlanning.body.status, "needs_input");
    assert.deepEqual(
      new Set(initialPlanning.body.missingSlots),
      new Set(["origin", "transportMode"]),
    );

    conversation = applyUserTurn(conversation, scenario.transportInput);
    const transportPlanning = await callAction("/api/gpt/planning/start", {
      message: scenario.transportInput,
      ...conversation,
    });
    assertActionStatus(scenario.id, "transport planning", transportPlanning, 200);
    assert.equal(transportPlanning.body.status, "needs_input");
    assert.deepEqual(transportPlanning.body.missingSlots, ["origin"]);

    conversation = applyUserTurn(conversation, scenario.origin);
    const recommendation = await callAction(
      "/api/gpt/itineraries/recommend",
      {
        invocationId: `external-scenario-${scenario.id}-${Date.now()}`,
        latestUserMessage: scenario.origin,
        ...conversation,
      },
    );
    assertActionStatus(scenario.id, "recommendation", recommendation, 200);
    assert.equal(
      recommendation.body.status,
      "ready",
      `${scenario.id} failed: ${JSON.stringify(recommendation.body)}`,
    );
    assert.equal(recommendation.body.origin, scenario.origin);
    assert.equal(recommendation.body.destination, scenario.destination);
    assert.equal(recommendation.body.durationDays, scenario.durationDays);
    assert.equal(recommendation.body.transportMode, scenario.transportMode);
    assert.ok(recommendation.body.highlights.length > 0);
    assert.equal(
      recommendation.body.detailLinkMarkdown,
      `[상세 일정 열기](${recommendation.body.pageUrl})`,
    );

    const detailRedirect = await fetch(recommendation.body.pageUrl, {
      redirect: "manual",
    });
    assert.equal(detailRedirect.status, 302);
    assert.equal(
      detailRedirect.headers.get("location"),
      `${webOrigin}/itinerary/${recommendation.body.itineraryId}`,
    );

    scenarioResults.push({ scenario, terminal: recommendation.body });
    console.log(
      `${scenario.id} ready: ${scenario.destination}/${scenario.origin}/${scenario.transportInput}/${scenario.durationDays}일 itineraryId=${recommendation.body.itineraryId}`,
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const { scenario, terminal } of scenarioResults) {
      const response = await page.goto(terminal.pageUrl, {
        waitUntil: "networkidle",
      });
      assert.equal(response?.status(), 200);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        `${scenario.destination} 여행 일정`,
      );
      await page.getByText(terminal.highlights[0], { exact: true }).first().waitFor();
      assert.equal(await page.getByTestId("destination-editor").count(), 0);
    }
  } finally {
    await browser.close();
  }

  console.log(
    `PlanME real-provider predeploy E2E passed: ${scenarioResults.map(({ scenario }) => scenario.id).join(", ")}.`,
  );
} catch (error) {
  for (const [name, output] of outputByName) {
    if (output.trim()) {
      console.error(`[${name}] ${output.slice(-6_000)}`);
    }
  }
  throw error;
} finally {
  stopServers();
}

function assertExternalConfirmation() {
  assert.equal(
    process.argv.includes("--confirm-external-api"),
    true,
    "실제 외부 API 호출에는 --confirm-external-api가 필요합니다.",
  );
}

function assertRequiredProviderConfiguration() {
  const requiredGroups = [
    ["TOUR_API_SERVICE_KEY"],
    ["OPENAI_API_KEY"],
    ["NAVER_MAPS_CLIENT_ID", "NCP_MAPS_CLIENT_ID"],
    ["NAVER_MAPS_CLIENT_SECRET", "NCP_MAPS_CLIENT_SECRET"],
    ["NAVER_SEARCH_CLIENT_ID"],
    ["NAVER_SEARCH_CLIENT_SECRET"],
    ["ODSAY_API_KEY"],
  ];
  const missing = requiredGroups
    .filter((names) => !names.some((name) => process.env[name]?.trim()))
    .map((names) => names.join(" 또는 "));
  assert.deepEqual(
    missing,
    [],
    `실제 공급자 테스트 환경변수가 없습니다: ${missing.join(", ")}`,
  );
}

function assertActionStatus(scenarioId, phase, result, expectedStatus) {
  assert.equal(
    result.status,
    expectedStatus,
    `${scenarioId} ${phase} HTTP ${result.status}: ${JSON.stringify(result.body)}`,
  );
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
    outputByName.set(name, `${current}${chunk}`.slice(-12_000));
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
      // The local server process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local server did not become ready: ${url}`);
}

async function callAction(path, body) {
  const response = await fetch(`${mcpOrigin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  return { status: response.status, body: payload };
}

function applyUserTurn(previous, message) {
  const next = { ...previous };
  const normalized = message.trim();
  if (!next.destination || !next.durationDays) {
    const match = normalized.match(/^(.+?)\s+(\d+)박\s*(\d+)일(?:\s+여행(?:\s+추천)?)?$/);
    assert.ok(match, `첫 여행 프롬프트를 해석할 수 없습니다: ${message}`);
    next.destination = match[1].trim();
    next.durationDays = Number(match[3]);
    return next;
  }
  if (!next.transportMode && ["자동차", "대중교통"].includes(normalized)) {
    next.transportMode = normalized;
    return next;
  }
  if (!next.origin) {
    next.origin = normalized;
    return next;
  }
  throw new Error(`예상하지 않은 추가 사용자 턴입니다: ${message}`);
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
