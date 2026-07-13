/**
 * Serializes JSON safely for embedding in a script tag.
 */
function serializeForScript(value: object): string {
  // Escape closing tags and separators so the JSON cannot terminate the script block.
  return JSON.stringify(value)
    .replaceAll("</", "<\\/")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * Builds the PlanME Apps SDK widget HTML returned as an MCP app resource.
 */
export function createPlanmeWidgetHtml(): string {
  const emptyItinerary = {
    detailUrl: "https://planme-demo.vercel.app",
    duration: "일정",
    region: "PlanME",
    savedDurationLabel: "계산 중",
    days: [
      {
        standard: {
          durationLabel: "확인 중",
          routeText: "일정 데이터를 불러오는 중",
        },
        carryme: {
          durationLabel: "확인 중",
          routeText: "일정 데이터를 불러오는 중",
        },
        timeline: [],
      },
    ],
  };

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>PlanME 일정 미리보기</title>
    <style>
      :root {
        color-scheme: light dark;
        --blue: #2563eb;
        --green: #16a34a;
        --ink: #111827;
        --muted: #64748b;
        --line: #dbe3ef;
        --surface: #ffffff;
        --soft: #f8fafc;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --ink: #f8fafc;
          --muted: #aab4c2;
          --line: #263244;
          --surface: #0f172a;
          --soft: #111c2f;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background: var(--surface);
      }
      .wrap { max-width: 760px; padding: 22px; }
      .head {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        margin-bottom: 18px;
      }
      .brand {
        color: var(--blue);
        font-size: 16px;
        font-weight: 800;
        margin-bottom: 6px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .saving {
        border: 1px solid color-mix(in srgb, var(--green) 35%, transparent);
        border-radius: 999px;
        padding: 10px 16px;
        color: var(--green);
        background: color-mix(in srgb, var(--green) 8%, transparent);
        font-weight: 800;
        white-space: nowrap;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 18px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px;
        background: var(--soft);
      }
      .card strong {
        display: block;
        margin-bottom: 4px;
        font-size: 15px;
      }
      .card p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
      }
      .days {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .day-card {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
      }
      .day-head {
        align-items: center;
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .day-head strong {
        font-size: 18px;
      }
      .day-head span {
        color: var(--muted);
        font-size: 13px;
        text-align: right;
      }
      .day-routes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }
      .day-route {
        background: var(--soft);
        border-radius: 10px;
        color: var(--muted);
        font-size: 12px;
        padding: 10px;
      }
      .day-route b {
        color: var(--ink);
        display: block;
        margin-bottom: 4px;
      }
      .timeline {
        margin-top: 16px;
        padding: 0 2px;
      }
      ul { list-style: none; margin: 0; padding: 0; }
      li {
        display: grid;
        grid-template-columns: 58px 30px 1fr;
        gap: 12px;
        min-height: 76px;
        position: relative;
      }
      li::after {
        content: "";
        position: absolute;
        left: 84px;
        top: 32px;
        bottom: 0;
        width: 3px;
        background: var(--green);
      }
      li:last-child::after { display: none; }
      .time {
        padding-top: 4px;
        font-size: 18px;
        font-weight: 800;
      }
      .dot {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        background: #334155;
        border: 4px solid var(--surface);
        box-shadow: 0 10px 24px rgba(15, 23, 42, .18);
        z-index: 1;
      }
      .highlight .dot { background: var(--blue); }
      li strong {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        font-size: 17px;
      }
      li p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      .footer {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: center;
        margin-top: 16px;
        padding: 14px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
        background: color-mix(in srgb, var(--green) 8%, transparent);
      }
      .footer strong {
        color: var(--green);
        font-size: 22px;
      }
      .empty {
        color: var(--muted);
        font-size: 15px;
        padding: 18px 0;
      }
      .link {
        color: white;
        background: var(--blue);
        text-decoration: none;
        border-radius: 10px;
        padding: 11px 14px;
        font-weight: 800;
        white-space: nowrap;
      }
      @media (max-width: 560px) {
        .wrap { padding: 16px; }
        .head, .footer { flex-direction: column; align-items: stretch; }
        .summary, .day-routes { grid-template-columns: 1fr; }
        .day-head { align-items: flex-start; flex-direction: column; }
        .day-head span { text-align: left; }
        h1 { font-size: 23px; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="head">
        <div>
          <div class="brand">PlanME</div>
          <h1 data-planme-title>PlanME 일정</h1>
        </div>
        <div class="saving" data-planme-saving>계산 중</div>
      </section>
      <section class="summary" aria-label="동선 비교 요약">
        <div class="card">
          <strong>Standard 전체</strong>
          <p data-planme-standard>일정 데이터를 불러오는 중</p>
        </div>
        <div class="card">
          <strong>CarryME 전체</strong>
          <p data-planme-carryme>일정 데이터를 불러오는 중</p>
        </div>
      </section>
      <section class="days" data-planme-days aria-label="일차별 CarryME 일정">
        <section class="day-card"><div class="empty">PlanME 일정 데이터를 불러오고 있습니다.</div></section>
      </section>
      <section class="footer">
        <div>
          <div>CarryME 총 이동 시간</div>
          <strong data-planme-carryme-duration>확인 중</strong>
        </div>
        <a class="link" data-planme-link href="https://planme-demo.vercel.app" target="_blank" rel="noreferrer">상세 일정 열기</a>
      </section>
    </main>
    <script type="application/json" id="planme-fallback">${serializeForScript(emptyItinerary)}</script>
    <script>
      const fallbackItinerary = JSON.parse(document.getElementById("planme-fallback").textContent);
      let latestToolResultItinerary = null;

	      function escapeText(value) {
	        return String(value ?? "")
	          .replaceAll("&", "&amp;")
	          .replaceAll("<", "&lt;")
	          .replaceAll(">", "&gt;")
	          .replaceAll('"', "&quot;")
	          .replaceAll("'", "&#39;");
	      }

	      function setText(selector, value) {
	        const element = document.querySelector(selector);

	        if (element) {
	          element.textContent = String(value ?? "");
	        }
	      }

	      function pickItinerary(value) {
	        if (!value || typeof value !== "object") {
	          return null;
	        }

	        return (
	          value.itinerary ||
	          value.structuredContent?.itinerary ||
	          value._meta?.itinerary ||
	          value.mcp_tool_result?._meta?.itinerary ||
	          value.call_tool_result?._meta?.itinerary ||
	          null
	        );
	      }

	      function getWidgetItinerary() {
	        const bridge = window.openai;
	        const metadataItinerary = pickItinerary(bridge?.toolResponseMetadata);
	        const outputItinerary = pickItinerary(bridge?.toolOutput);

	        // ChatGPT can deliver tool output after iframe load, so cache the latest bridge result.
	        return latestToolResultItinerary || metadataItinerary || outputItinerary || fallbackItinerary;
	      }

	      function formatDurationMinutes(minutes) {
	        const roundedMinutes = Math.max(0, Math.round(Number(minutes) || 0));
	        const hours = Math.floor(roundedMinutes / 60);
	        const remainder = roundedMinutes % 60;

	        if (roundedMinutes === 0) {
	          return "0분";
	        }

	        if (hours === 0) {
	          return "약 " + remainder + "분";
	        }

	        return remainder === 0
	          ? "약 " + hours + "시간"
	          : "약 " + hours + "시간 " + remainder + "분";
	      }

	      function getTotalDuration(days, routeId, fallbackLabel) {
	        const durations = days
	          .map((day) => Number(day?.[routeId]?.durationMinutes))
	          .filter((duration) => Number.isFinite(duration));

	        return durations.length === days.length && days.length > 0
	          ? formatDurationMinutes(durations.reduce((sum, duration) => sum + duration, 0))
	          : String(fallbackLabel ?? "확인 중");
	      }

	      function renderTimelineMarkup(timeline) {
	        const items = Array.isArray(timeline) ? timeline : [];

	        if (items.length === 0) {
	          return '<li><span class="time">--:--</span><span class="dot"></span><div><strong>일정 확인 중</strong><p>PlanME 일정 데이터를 불러오고 있습니다.</p></div></li>';
	        }

	        return items
	          .map((event) => '<li class="' + (event.highlight ? "highlight" : "") + '"><span class="time">' + escapeText(event.time) + '</span><span class="dot"></span><div><strong>' + escapeText(event.title) + '</strong><p>' + escapeText(event.description) + '</p></div></li>')
	          .join("");
	      }

	      function renderDays(days) {
	        const daysElement = document.querySelector("[data-planme-days]");

	        if (!daysElement) {
	          return;
	        }

	        daysElement.innerHTML = days
	          .map((day, index) => {
	            const standard = day.standard || fallbackItinerary.days[0].standard;
	            const carryme = day.carryme || fallbackItinerary.days[0].carryme;
	            const timeline = day.carrymeTimeline || day.timeline || [];
	            const dayNumber = Number(day.day) || index + 1;

	            return '<section class="day-card" data-planme-day="' + dayNumber + '">' +
	              '<div class="day-head"><strong>' + dayNumber + '일차</strong><span>Standard ' + escapeText(standard.durationLabel) + ' · CarryME ' + escapeText(carryme.durationLabel) + '</span></div>' +
	              '<div class="day-routes"><div class="day-route"><b>Standard</b>' + escapeText(standard.routeText) + '</div><div class="day-route"><b>CarryME</b>' + escapeText(carryme.routeText) + '</div></div>' +
	              '<div class="timeline"><ul>' + renderTimelineMarkup(timeline) + '</ul></div>' +
	              '</section>';
	          })
	          .join("");
	      }

	      function renderPlanmeWidget() {
	        const itinerary = getWidgetItinerary();
	        const days = Array.isArray(itinerary.days) && itinerary.days.length > 0
	          ? itinerary.days.slice(0, 3)
	          : fallbackItinerary.days;
	        const firstDay = days[0] || fallbackItinerary.days[0];
	        const totalLabels = String(itinerary.totalDurationLabel ?? "").split("→");
	        const standardTotal = getTotalDuration(days, "standard", totalLabels[0]?.trim() || firstDay.standard?.durationLabel);
	        const carrymeTotal = getTotalDuration(days, "carryme", totalLabels[1]?.trim() || firstDay.carryme?.durationLabel);

	        setText("[data-planme-title]", String(itinerary.region ?? "") + " " + String(itinerary.duration ?? ""));
	        const savingElement = document.querySelector("[data-planme-saving]");
	        const savingLabel = itinerary.savedDurationLabel;

	        if (savingElement) {
	          savingElement.style.display = savingLabel ? "flex" : "none";
	          if (savingLabel) {
	            savingElement.textContent = String(savingLabel);
	          }
	        }
	        setText("[data-planme-standard]", standardTotal);
	        setText("[data-planme-carryme]", carrymeTotal);
        setText("[data-planme-carryme-duration]", carrymeTotal);

        const link = document.querySelector("[data-planme-link]");

        if (link) {
          link.href = String(itinerary.detailUrl ?? fallbackItinerary.detailUrl);
        }

        renderDays(days);
      }

	      function handleToolResultMessage(event) {
	        if (event.source !== window.parent) {
	          return;
	        }

	        const message = event.data;

	        if (!message || message.jsonrpc !== "2.0" || message.method !== "ui/notifications/tool-result") {
	          return;
	        }

	        latestToolResultItinerary = pickItinerary(message.params) || latestToolResultItinerary;
	        renderPlanmeWidget();
	      }

      renderPlanmeWidget();
      window.addEventListener("openai:set_globals", renderPlanmeWidget);
      window.addEventListener("message", handleToolResultMessage);
      window.setTimeout(renderPlanmeWidget, 100);
      window.setTimeout(renderPlanmeWidget, 500);
    </script>
  </body>
</html>`;
}
