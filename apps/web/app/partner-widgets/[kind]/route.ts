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
#widget{min-height:${kind === "flight" ? "0" : "280"}px;padding:8px}#status{padding:20px;color:#566777;font-size:14px}
#tpwl-search{display:block;padding:16px;background:#f2f6fc;border:1px solid #d5e1ef;border-radius:16px}
@media(max-width:600px){#tpwl-search{padding:12px 8px}}
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
const observedRoots = new WeakSet();
function styleFlightSearch() {
  const host = document.getElementById('tpwl-search');
  const root = host?.shadowRoot;
  if (!root) return;
  // Keep provider-specific CSS isolated here; stable input names identify fields.
  if (!root.getElementById('planme-search-style')) {
    const style = document.createElement('style');
    style.id = 'planme-search-style';
    style.textContent = \`
      [data-planme-field]{position:relative;background:#fff!important;border:1px solid #9fb5cf!important;border-radius:10px!important;min-height:68px;padding:0!important}
      [data-planme-field]::before{content:attr(data-planme-field);position:absolute;top:9px;left:16px;font-size:11px;font-weight:600;line-height:14px;color:#45617f;pointer-events:none}
      [data-planme-field]>input{height:68px;box-sizing:border-box;padding:28px 38px 10px 16px!important;color:#193858!important}
      [data-planme-field]>input::placeholder{color:#61758c!important;opacity:1}
      [data-planme-field]:focus-within{box-shadow:inset 0 0 0 2px #1955a5,0 0 0 3px #1955a51a!important}
      [data-planme-field]:has(>input[name="passengers"])>input{height:45px;padding-bottom:0!important;padding-right:0!important}
      [data-planme-field]:has(>input[name="passengers"])>div[class*="subvalue"]{padding:0 16px 8px;font-size:11px;color:#61758c}
    \`;
    root.appendChild(style);
  }
  const labels = {origin:'From',destination:'To','from-date':'Departure date','to-date':'Return date',passengers:'Travelers'};
  for (const [name, label] of Object.entries(labels)) {
    const input = root.querySelector('input[name="' + name + '"]');
    if (input) {
      input.parentElement.dataset.planmeField = label;
      input.setAttribute('aria-label', label);
    }
  }
  for (const element of [host, document.getElementById('tpwl-tickets'), document.getElementById('tpwl-modals')]) {
    if (!element?.shadowRoot || observedRoots.has(element.shadowRoot)) continue;
    observedRoots.add(element.shadowRoot);
    new MutationObserver(update).observe(element.shadowRoot,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    new ResizeObserver(update).observe(element);
  }
}
// Tiqets' official loader uses this message after rendering its contents.
// Keep its iframe visible during loading so Chromium can render and report its size.
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
    styleFlightSearch();
    const loaded = ${kind === "flight" ? "!!document.getElementById('tpwl-search').shadowRoot?.querySelector('input')" : "tourReady"};
    if (loaded) {
      document.getElementById('status').hidden = true;
      document.getElementById('failure').hidden = true;
      widget.style.visibility = 'visible';
      widget.removeAttribute('data-failed');
    }
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    const searchRoot = document.getElementById('tpwl-modals')?.shadowRoot;
    const hasPopup = [...(searchRoot?.querySelectorAll('[class*="Modal-module__root"],[class*="Popover-module__visible"]') || [])].some(el => el.getBoundingClientRect().height > 0);
    const hasResults = (document.getElementById('tpwl-tickets')?.getBoundingClientRect().height || 0) > 0;
    parent.postMessage({type:'planme-partner-height',height,expanded:hasPopup || hasResults}, location.origin);
  });
}
new ResizeObserver(update).observe(document.body);
new MutationObserver(update).observe(document.body,{childList:true,subtree:true});
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
