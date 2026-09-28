import cities from "@/lib/partners/tiqets-cities.json";

/** Public embed identifiers issued for the Planme project on 2026-09-28. */
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (kind !== "flight" && kind !== "tour") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const requestedCity = url.searchParams.get("city");
  const city = cities.find((item) => item.id === requestedCity)?.id ?? "73067";
  const ko = url.searchParams.get("lang") === "ko";
  const tourParams = new URLSearchParams({ currency: "USD", trs: "576970", shmarker: "766533",
    language: "en", locale: city, layout: "horizontal", cards: "4", powered_by: "false",
    campaign_id: "89", promo_id: "3947" });
  const scriptUrl = kind === "flight"
    ? "https://tpscr.com/wl_web/main.js?wl_id=22736"
    : `https://tpscr.com/content?${tourParams}`;
  const html = `<!doctype html><html lang="${ko ? "ko" : "en"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${kind === "flight" ? "FlyME" : "PlayME"}</title>
<style>html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif}*{box-sizing:border-box}
#widget{min-height:${kind === "flight" ? "600" : "280"}px;padding:8px;${kind === "tour" ? "visibility:hidden" : ""}}#status{padding:20px;color:#566777;font-size:14px}
#widget[data-failed]{min-height:0;height:0;overflow:hidden;padding:0}
#failure{margin:0;padding:20px;color:#566777}iframe{max-width:100%}</style></head><body>
<p id="status" role="status">${ko ? "검색 도구를 불러오고 있습니다…" : "Loading travel search…"}</p>
<div id="widget">${kind === "flight" ? '<div id="tpwl-search"></div><div id="tpwl-tickets"></div>' : ""}
<script ${kind === "flight" ? 'type="module"' : 'charset="utf-8"'} async src="${scriptUrl.replaceAll("&", "&amp;")}" onerror="document.getElementById('status').hidden=true;document.getElementById('failure').hidden=false;document.getElementById('widget').setAttribute('data-failed','')"></script></div>
<p id="failure" role="status" hidden>${ko ? "검색 도구를 불러오지 못했습니다. 페이지 아래 제휴 사이트 링크를 이용해 주세요." : "Travel search could not load. Please use the partner link below."}</p>
<script>
const widget = document.getElementById('widget');
let scheduled = false;
let tourReady = false;
// Tiqets' official loader uses this message after rendering its contents.
window.addEventListener('message', (event) => {
  const frame = widget.querySelector('iframe');
  if (event.origin !== 'https://www.tiqets.com' || event.source !== frame?.contentWindow) return;
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (data?.event === 'postWidgetSize' && Number(data.payload?.height) > 0) {
      tourReady = true;
      update();
    }
  } catch { /* Ignore unrelated third-party messages. */ }
});
function update() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const loaded = ${kind === "flight" ? "!!document.getElementById('tpwl-search').shadowRoot?.querySelector('input')" : "tourReady"};
    if (loaded) {
      document.getElementById('status').hidden = true;
      document.getElementById('failure').hidden = true;
      widget.style.visibility = 'visible';
      widget.removeAttribute('data-failed');
    }
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    parent.postMessage({type:'planme-partner-height',height}, location.origin);
  });
}
new ResizeObserver(update).observe(document.body);
new MutationObserver(update).observe(widget,{childList:true,subtree:true});
window.addEventListener('load',update);
const readiness = setInterval(() => {
  update();
  if (document.getElementById('status').hidden) clearInterval(readiness);
}, 500);
setTimeout(() => {
  clearInterval(readiness);
  if (!document.getElementById('status').hidden) {
    document.getElementById('status').hidden = true;
    document.getElementById('failure').hidden = false;
    widget.setAttribute('data-failed','');
  }
}, 20000);
update();
</script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "frame-ancestors 'self'",
  } });
}
