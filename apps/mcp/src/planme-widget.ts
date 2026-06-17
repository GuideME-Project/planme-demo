import { getDemoItinerary } from "@planme/core";

const fallbackItinerary = getDemoItinerary();

/**
 * Escapes HTML-sensitive characters before embedding data into the widget shell.
 */
function escapeHtml(value: string): string {
  // Keep the widget resource self-contained without trusting itinerary copy as markup.
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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
  const firstDay = fallbackItinerary.days[0];
  const timelineItems = firstDay.timeline
    .map(
      (event) => `
        <li class="${event.highlight ? "highlight" : ""}">
          <span class="time">${escapeHtml(event.time)}</span>
          <span class="dot"></span>
          <div>
            <strong>${escapeHtml(event.title)}</strong>
            <p>${escapeHtml(event.description)}</p>
          </div>
        </li>`,
    )
    .join("");

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
      .wrap { max-width: 720px; padding: 22px; }
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
      .timeline {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 18px 18px 8px;
      }
      ul { list-style: none; margin: 0; padding: 0; }
      li {
        display: grid;
        grid-template-columns: 58px 30px 1fr;
        gap: 12px;
        min-height: 86px;
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
        font-size: 20px;
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
        .summary { grid-template-columns: 1fr; }
        h1 { font-size: 23px; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="head">
        <div>
          <div class="brand">PlanME</div>
          <h1>${escapeHtml(fallbackItinerary.region)} ${escapeHtml(fallbackItinerary.duration)}</h1>
        </div>
        <div class="saving">${escapeHtml(fallbackItinerary.savedDurationLabel)}</div>
      </section>
      <section class="summary" aria-label="동선 비교 요약">
        <div class="card">
          <strong>Standard</strong>
          <p>${escapeHtml(firstDay.standard.routeText)} · ${escapeHtml(firstDay.standard.durationLabel)}</p>
        </div>
        <div class="card">
          <strong>CarryME</strong>
          <p>${escapeHtml(firstDay.carryme.routeText)} · ${escapeHtml(firstDay.carryme.durationLabel)}</p>
        </div>
      </section>
      <section class="timeline" aria-label="CarryME 일정 타임라인">
        <ul>${timelineItems}</ul>
      </section>
      <section class="footer">
        <div>
          <div>CarryME 총 이동 시간(예상)</div>
          <strong>${escapeHtml(firstDay.carryme.durationLabel)}</strong>
        </div>
        <a class="link" href="${escapeHtml(fallbackItinerary.detailUrl)}" target="_blank" rel="noreferrer">상세 일정 열기</a>
      </section>
    </main>
    <script type="application/json" id="planme-fallback">${serializeForScript(fallbackItinerary)}</script>
  </body>
</html>`;
}
