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
  const planningTool = listed.tools.find((tool) => tool.name === "start_planme_planning");
  const recommendTool = listed.tools.find(
    (tool) => tool.name === "recommend_planme_itinerary",
  );
  const getTool = listed.tools.find((tool) => tool.name === "get_planme_itinerary");
  assert.match(planningTool?.description ?? "", /출발지·목적지·이동수단·여행 일정/);
  assert.match(recommendTool?.description ?? "", /processing.*get_planme_itinerary/);
  assert.match(recommendTool?.description ?? "", /ready.*추가 입력을 요구하지 마세요/);
  assert.match(recommendTool?.description ?? "", /failed.*자동 재시도/);
  assert.match(getTool?.description ?? "", /processing.*같은 itineraryId/);
  assert.match(getTool?.description ?? "", /failed.*기술 오류 코드/);

  const assessment = await callMcp(3, "tools/call", {
    name: "start_planme_planning",
    arguments: { origin: "서울역" },
  });
  assert.equal(assessment.structuredContent?.status, "needs_input");
  assert.deepEqual(assessment.structuredContent?.missingSlots, ["transportMode"]);
  assert.deepEqual(
    assessment.structuredContent?.questions.map(({ slot }) => slot),
    ["transportMode"],
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

  const koreanTransitReplay = await callMcp(requestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: { ...toolArguments, transportMode: "대중교통" },
  });
  assert.equal(koreanTransitReplay.structuredContent?.itineraryId, itineraryId);

  const koreanDriveRequestId = `local-korean-drive-${Date.now()}`;
  const koreanDrive = await callMcp(koreanDriveRequestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: { ...toolArguments, transportMode: "자동차" },
  });
  assert.equal(koreanDrive.structuredContent?.status, "processing");
  assert.ok(koreanDrive.structuredContent?.itineraryId);

  const englishDriveReplay = await callMcp(koreanDriveRequestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: { ...toolArguments, transportMode: "drive" },
  });
  assert.equal(
    englishDriveReplay.structuredContent?.itineraryId,
    koreanDrive.structuredContent?.itineraryId,
  );

  const distinctInput = await callMcp(requestId, "tools/call", {
    name: "recommend_planme_itinerary",
    arguments: { ...toolArguments, destination: "경주" },
  });
  assert.equal(distinctInput.structuredContent?.status, "processing");
  assert.notEqual(distinctInput.structuredContent?.itineraryId, itineraryId);

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

  const scenarioResults = [];
  const scenarios = [
    {
      id: "1-a",
      prompt: "부산역 1박 2일 여행 추천",
      destination: "부산역",
      durationDays: 2,
      origin: "동탄",
      transportInput: "자동차",
      transportMode: "drive",
      expectedVisit: "해운대",
      expectedLodging: "부산 호텔",
    },
    {
      id: "1-b",
      prompt: "부산역 1박 2일 여행 추천",
      destination: "부산역",
      durationDays: 2,
      origin: "동탄",
      transportInput: "대중교통",
      transportMode: "transit",
      expectedVisit: "해운대",
      expectedLodging: "부산 호텔",
    },
    {
      id: "2-a",
      prompt: "양양 2박 3일 여행 추천",
      destination: "양양",
      durationDays: 3,
      origin: "마포구청",
      transportInput: "자동차",
      transportMode: "drive",
      expectedVisit: "낙산사",
      expectedLodging: "양양 호텔",
    },
    {
      id: "2-b",
      prompt: "양양 2박 3일 여행 추천",
      destination: "양양",
      durationDays: 3,
      origin: "마포구청",
      transportInput: "대중교통",
      transportMode: "transit",
      expectedVisit: "낙산사",
      expectedLodging: "양양 호텔",
    },
  ];

  // Exercise GPTs Action multi-turn state through HTTP only; no browser automation runs here.
  for (const scenario of scenarios) {
    let conversation = applyUserTurn({}, scenario.prompt);
    const initialPlanning = await callAction("/api/gpt/planning/start", {
      message: scenario.prompt,
      ...conversation,
    });
    assert.equal(initialPlanning.status, 200);
    assert.equal(initialPlanning.body.status, "needs_input");
    assert.deepEqual(initialPlanning.body.missingSlots, ["transportMode"]);
    assert.deepEqual(initialPlanning.body.questions.map(({ slot }) => slot), [
      "transportMode",
    ]);

    conversation = applyUserTurn(conversation, scenario.transportInput);
    const transportPlanning = await callAction("/api/gpt/planning/start", {
      message: scenario.transportInput,
      ...conversation,
    });
    assert.equal(transportPlanning.status, 200);
    assert.equal(transportPlanning.body.status, "needs_input");
    assert.deepEqual(transportPlanning.body.missingSlots, ["origin"]);
    assert.deepEqual(transportPlanning.body.questions.map(({ slot }) => slot), [
      "origin",
    ]);

    conversation = applyUserTurn(conversation, scenario.origin);
    const recommendation = await callAction(
      "/api/gpt/itineraries/recommend",
      {
        invocationId: `local-scenario-${scenario.id}-${Date.now()}`,
        latestUserMessage: scenario.origin,
        ...conversation,
      },
    );
    assert.equal(recommendation.status, 200);
    assert.equal(recommendation.body.status, "ready");
    assert.equal(recommendation.body.origin, scenario.origin);
    assert.equal(recommendation.body.destination, scenario.destination);
    assert.equal(recommendation.body.durationDays, scenario.durationDays);
    assert.equal(recommendation.body.transportMode, scenario.transportMode);
    assert.match(recommendation.body.finalAnswerMarkdown, new RegExp(scenario.origin));
    assert.match(
      recommendation.body.finalAnswerMarkdown,
      new RegExp(scenario.transportInput),
    );
    assert.equal(recommendation.body.finalAnswerMarkdown.endsWith(
      `상세 일정: ${recommendation.body.pageUrl}`,
    ), true);

    const detailRedirect = await fetch(recommendation.body.pageUrl, {
      redirect: "manual",
    });
    assert.equal(detailRedirect.status, 302);
    assert.equal(
      detailRedirect.headers.get("location"),
      `${webOrigin}/itinerary/${recommendation.body.itineraryId}`,
    );
    scenarioResults.push({ scenario, terminal: recommendation.body });
  }

  const appScenarioResults = [];
  let appRequestId = 1_000;
  // Exercise the same multi-turn scenarios through MCP JSON-RPC tool calls.
  for (const scenario of scenarios) {
    let conversation = applyUserTurn({}, scenario.prompt);
    const initialPlanning = await callMcp(appRequestId++, "tools/call", {
      name: "start_planme_planning",
      arguments: { message: scenario.prompt, ...conversation },
    });
    assert.equal(initialPlanning.structuredContent?.status, "needs_input");
    assert.deepEqual(
      initialPlanning.structuredContent?.missingSlots,
      ["transportMode"],
    );
    assert.deepEqual(
      initialPlanning.structuredContent?.questions?.map(({ slot }) => slot),
      ["transportMode"],
    );

    conversation = applyUserTurn(conversation, scenario.transportInput);
    const transportPlanning = await callMcp(appRequestId++, "tools/call", {
      name: "start_planme_planning",
      arguments: { message: scenario.transportInput, ...conversation },
    });
    assert.equal(transportPlanning.structuredContent?.status, "needs_input");
    assert.deepEqual(transportPlanning.structuredContent?.missingSlots, ["origin"]);
    assert.deepEqual(
      transportPlanning.structuredContent?.questions?.map(({ slot }) => slot),
      ["origin"],
    );

    conversation = applyUserTurn(conversation, scenario.origin);
    const startedScenario = await callMcp(appRequestId++, "tools/call", {
      name: "recommend_planme_itinerary",
      arguments: conversation,
    });
    assert.equal(startedScenario.structuredContent?.status, "processing");
    const scenarioItineraryId = startedScenario.structuredContent?.itineraryId;
    assert.ok(scenarioItineraryId);

    let scenarioTerminal = null;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const status = await callMcp(appRequestId++, "tools/call", {
        name: "get_planme_itinerary",
        arguments: { itineraryId: scenarioItineraryId },
      });
      if (status.structuredContent?.status !== "processing") {
        scenarioTerminal = status.structuredContent;
        break;
      }
    }
    assert.equal(scenarioTerminal?.status, "ready");
    assert.equal(scenarioTerminal?.widget?.title, `${scenario.destination} 여행 일정`);
    assert.equal(scenarioTerminal?.widget?.durationDays, scenario.durationDays);
    assert.equal(scenarioTerminal?.widget?.transportMode, scenario.transportMode);
    appScenarioResults.push({ scenario, terminal: scenarioTerminal });
  }

  // Start Playwright only after API/tool completion to verify the generated detail pages.
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

    for (const { scenario, terminal: scenarioTerminal } of scenarioResults) {
      const scenarioResponse = await page.goto(scenarioTerminal.pageUrl, {
        waitUntil: "networkidle",
      });
      assert.equal(scenarioResponse?.status(), 200);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        `${scenario.destination} 여행 일정`,
      );
      const scenarioBody = await page.locator("body").innerText();
      assert.match(scenarioBody, new RegExp(scenario.expectedVisit));
      assert.match(scenarioBody, new RegExp(scenario.expectedLodging));
      assert.equal(await page.getByTestId("destination-editor").count(), 0);
    }
    for (const { scenario, terminal: scenarioTerminal } of appScenarioResults) {
      const scenarioResponse = await page.goto(scenarioTerminal.pageUrl, {
        waitUntil: "networkidle",
      });
      assert.equal(scenarioResponse?.status(), 200);
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        `${scenario.destination} 여행 일정`,
      );
      const scenarioBody = await page.locator("body").innerText();
      assert.match(scenarioBody, new RegExp(scenario.expectedVisit));
      assert.match(scenarioBody, new RegExp(scenario.expectedLodging));
      assert.equal(await page.getByTestId("destination-editor").count(), 0);
    }
    assert.deepEqual(forbiddenBrowserRequests, []);
  } finally {
    await browser.close();
  }

  console.log(
    [
      `PlanME local two-server integration passed: ${itineraryId} revision 1 ready, detail page rendered, browser provider requests 0.`,
      `Scenarios passed: ${scenarioResults.map(({ scenario }) =>
        `${scenario.id} ${scenario.destination}/${scenario.origin}/${scenario.transportInput}/${scenario.durationDays}일`
      ).join(", ")}.`,
      `MCP App conversations passed: ${appScenarioResults.map(({ scenario }) => scenario.id).join(", ")}.`,
    ].join("\n"),
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

async function callAction(path, body) {
  const response = await fetch(`${mcpOrigin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function applyUserTurn(previous, message) {
  // Deterministically carries slots between turns; this does not execute the ChatGPT model.
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
