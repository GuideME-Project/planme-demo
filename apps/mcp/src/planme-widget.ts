import { getDemoItinerary } from "@planme/core";

const fallbackItinerary = getDemoItinerary();
const googleMapsApiKey =
  process.env.PLANME_GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

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
  const routeMapData = {
    apiKey: googleMapsApiKey,
    carrymePath: firstDay.carryme.geoPath ?? [],
    dashedPath: firstDay.carryme.dashedGeoPath ?? [],
    stops: firstDay.standard.stops,
    standardPath: firstDay.standard.geoPath ?? [],
  };
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
        margin-top: 14px;
        padding: 18px 18px 8px;
      }
      .map {
        background:
          linear-gradient(rgba(37, 99, 235, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(37, 99, 235, 0.1) 1px, transparent 1px),
          linear-gradient(135deg, #dceeff 0%, #f6fbff 48%, #e9f8ec 100%);
        background-size: 44px 44px, 44px 44px, auto;
        border: 1px solid var(--line);
        border-radius: 16px;
        height: 250px;
        margin-top: 14px;
        overflow: hidden;
        position: relative;
      }
      .map-canvas {
        inset: 0;
        position: absolute;
      }
      .map-fallback {
        align-items: center;
        color: var(--muted);
        display: flex;
        font-size: 14px;
        inset: 0;
        justify-content: center;
        padding: 18px;
        position: absolute;
        text-align: center;
      }
      .map-legend {
        background: color-mix(in srgb, var(--surface) 88%, transparent);
        border: 1px solid var(--line);
        border-radius: 10px;
        bottom: 12px;
        display: grid;
        gap: 6px;
        padding: 9px 10px;
        position: absolute;
        right: 12px;
        z-index: 2;
      }
      .map-legend span {
        align-items: center;
        color: var(--ink);
        display: flex;
        font-size: 12px;
        font-weight: 700;
        gap: 8px;
      }
      .map-legend i {
        border-radius: 999px;
        display: block;
        width: 24px;
      }
      .map-legend .standard i { border-top: 3px solid var(--blue); }
      .map-legend .carryme i { border-top: 3px solid var(--green); }
      .map-legend .dashed i { border-top: 2px dashed var(--green); }
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
      @media (prefers-color-scheme: dark) {
        .map {
          background:
            linear-gradient(rgba(148, 163, 184, 0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px),
            linear-gradient(135deg, #111827 0%, #17212d 48%, #0e2530 100%);
          background-size: 44px 44px, 44px 44px, auto;
        }
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
      <section class="map" aria-label="Google Maps 경로 미리보기">
        <div class="map-canvas" id="planme-map"></div>
        <div class="map-fallback" id="planme-map-fallback">지도 미리보기를 불러오는 중입니다.</div>
        <div class="map-legend" aria-hidden="true">
          <span class="standard"><i></i>Standard</span>
          <span class="carryme"><i></i>CarryME</span>
          <span class="dashed"><i></i>짐 탁송</span>
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
    <script type="application/json" id="planme-map-data">${serializeForScript(routeMapData)}</script>
    <script>
      (() => {
        const dataElement = document.getElementById("planme-map-data");
        const mapElement = document.getElementById("planme-map");
        const fallbackElement = document.getElementById("planme-map-fallback");

        if (!dataElement || !mapElement || !fallbackElement) {
          return;
        }

        const mapData = JSON.parse(dataElement.textContent || "{}");
        const hasPath = Array.isArray(mapData.standardPath) && mapData.standardPath.length > 0;

        if (!mapData.apiKey || !hasPath) {
          fallbackElement.textContent = "지도 API 키 또는 경로 데이터가 없어 타임라인만 표시합니다.";
          return;
        }

        const setFallback = (message) => {
          fallbackElement.textContent = message;
          fallbackElement.style.display = "flex";
        };
        const hideFallback = () => {
          fallbackElement.style.display = "none";
        };
        window.gm_authFailure = () => {
          setFallback("Google Maps API 키 제한으로 지도를 표시하지 못해 타임라인만 표시합니다.");
        };
        const loadScript = () =>
          new Promise((resolve, reject) => {
            if (window.google?.maps) {
              resolve(window.google.maps);
              return;
            }

            const script = document.createElement("script");
            const params = new URLSearchParams({
              key: mapData.apiKey,
              v: "weekly",
            });

            script.async = true;
            script.defer = true;
            script.onerror = () => reject(new Error("Google Maps script failed"));
            script.onload = () => {
              if (window.google?.maps) {
                resolve(window.google.maps);
                return;
              }

              reject(new Error("Google Maps namespace missing"));
            };
            script.src = "https://maps.googleapis.com/maps/api/js?" + params.toString();
            document.head.append(script);
          });

        loadScript()
          .then((maps) => {
            const map = new maps.Map(mapElement, {
              center: { lat: 34.56, lng: 135.38 },
              clickableIcons: false,
              disableDefaultUI: true,
              mapTypeControl: false,
              streetViewControl: false,
              zoom: 10,
              zoomControl: false,
            });
            const bounds = new maps.LatLngBounds();
            const arrow = {
              fillColor: "#ffffff",
              fillOpacity: 1,
              path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 2.2,
              strokeColor: "#ffffff",
              strokeWeight: 1,
            };
            const drawRoute = (path, color, opacity) => {
              if (!Array.isArray(path) || path.length === 0) {
                return;
              }

              path.forEach((point) => bounds.extend(point));
              new maps.Polyline({
                geodesic: true,
                icons: [{ icon: arrow, offset: "28%", repeat: "34%" }],
                map,
                path,
                strokeColor: color,
                strokeOpacity: opacity,
                strokeWeight: 4,
              });
            };

            drawRoute(mapData.standardPath, "#2563eb", 0.95);
            drawRoute(mapData.carrymePath, "#16a34a", 0.95);
            drawRoute(mapData.dashedPath, "#16a34a", 0.55);
            (mapData.stops || []).forEach((stop, index) => {
              if (!stop.coordinate) {
                return;
              }

              bounds.extend(stop.coordinate);
              new maps.Marker({
                icon: {
                  fillColor: index === 2 ? "#16a34a" : "#2563eb",
                  fillOpacity: 1,
                  path: maps.SymbolPath.CIRCLE,
                  scale: 9,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                },
                label: {
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: "800",
                  text: String(index + 1),
                },
                map,
                position: stop.coordinate,
                title: stop.label,
              });
            });

            map.fitBounds(bounds);
            hideFallback();
          })
          .catch(() => {
            setFallback("Google Maps를 위젯 안에서 표시하지 못해 타임라인만 표시합니다.");
          });
      })();
    </script>
  </body>
</html>`;
}
