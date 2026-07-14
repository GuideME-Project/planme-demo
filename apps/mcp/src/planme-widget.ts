export function createPlanmeWidgetHtml(): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>PlanME 일정</title>
    <style>
      :root { color-scheme: light dark; --blue:#2563eb; --green:#16a34a; --ink:#111827; --muted:#64748b; --line:#dbe3ef; --surface:#fff; --soft:#f8fafc; }
      @media (prefers-color-scheme:dark) { :root { --ink:#f8fafc; --muted:#aab4c2; --line:#263244; --surface:#0f172a; --soft:#111c2f; } }
      * { box-sizing:border-box; }
      body { margin:0; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:var(--surface); }
      main { max-width:720px; padding:22px; }
      .brand { color:var(--blue); font-size:15px; font-weight:800; margin-bottom:6px; }
      h1 { margin:0; font-size:26px; line-height:1.25; }
      .status { margin:12px 0 18px; color:var(--muted); }
      .progress { height:6px; overflow:hidden; border-radius:99px; background:var(--line); }
      .progress::after { content:""; display:block; width:38%; height:100%; border-radius:inherit; background:var(--blue); animation:move 1.2s ease-in-out infinite alternate; }
      @keyframes move { from { transform:translateX(-20%); } to { transform:translateX(190%); } }
      .summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:18px 0; }
      .card { border:1px solid var(--line); border-radius:12px; padding:14px; background:var(--soft); }
      .card span { display:block; color:var(--muted); font-size:12px; margin-bottom:5px; }
      .card strong { font-size:19px; }
      .saving strong { color:var(--green); }
      .days { display:grid; gap:12px; }
      .day { border:1px solid var(--line); border-radius:14px; padding:15px; }
      .day h2 { margin:0 0 10px; font-size:17px; }
      ul { margin:0; padding-left:20px; color:var(--muted); }
      li + li { margin-top:7px; }
      .excluded { margin-top:14px; border-left:3px solid #f59e0b; padding:8px 12px; color:var(--muted); }
      a { display:inline-block; margin-top:18px; border-radius:10px; padding:11px 14px; color:#fff; background:var(--blue); text-decoration:none; font-weight:800; }
      [hidden] { display:none !important; }
      @media (max-width:560px) { main { padding:16px; } .summary { grid-template-columns:1fr; } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">PlanME · TourAPI</div>
      <h1 data-title>여행 일정을 만들고 있습니다</h1>
      <p class="status" data-status>확인된 장소로 안전한 동선을 계산하는 중입니다.</p>
      <div class="progress" data-progress></div>
      <section class="summary" data-summary hidden>
        <div class="card"><span>Standard 이동</span><strong data-standard>-</strong></div>
        <div class="card"><span>CarryME 이동</span><strong data-carryme>-</strong></div>
        <div class="card saving"><span>절약 시간</span><strong data-saving>-</strong></div>
      </section>
      <section class="days" data-days></section>
      <div class="excluded" data-excluded hidden></div>
      <a data-link href="#" target="_blank" rel="noreferrer" hidden>상세 일정 열기</a>
    </main>
    <script>
      const startedAt = Date.now();
      const maxAttempts = 64;
      const maxElapsedMs = 120000;
      let attempts = 0;
      let pendingTimer = null;
      let currentJob = null;
      let terminal = false;

      function text(selector, value) {
        const element = document.querySelector(selector);
        if (element) element.textContent = String(value ?? "");
      }

      function pickJob(value) {
        if (!value || typeof value !== "object") return null;
        if (["processing", "ready", "failed"].includes(value.status)) return value;
        return value.planmeJob || value.structuredContent || value._meta?.planmeJob ||
          value.toolOutput?.structuredContent || value.toolResponseMetadata?.planmeJob || null;
      }

      function bridgeJob() {
        if (terminal) return currentJob;
        return pickJob(window.openai?.toolOutput) ||
          pickJob(window.openai?.toolResponseMetadata) || currentJob;
      }

      function render(job) {
        if (!job) return;
        if (terminal && job.status === "processing") return;
        currentJob = job;
        if (job.status === "processing") {
          text("[data-title]", "여행 일정을 만들고 있습니다");
          text("[data-status]", "현재 단계: " + String(job.phase || "처리 중") + " · 사용자 입력 없이 자동으로 계속합니다.");
          document.querySelector("[data-progress]")?.removeAttribute("hidden");
          scheduleNext(job);
          return;
        }
        if (pendingTimer) window.clearTimeout(pendingTimer);
        pendingTimer = null;
        document.querySelector("[data-progress]")?.setAttribute("hidden", "");
        if (job.status === "failed") {
          terminal = true;
          text("[data-title]", "일정을 완성하지 못했습니다");
          text("[data-status]", job.message || "안전한 여행 일정을 완성하지 못했습니다.");
          return;
        }
        terminal = true;
        const widget = job.widget;
        text("[data-title]", widget.title);
        text("[data-status]", "TourAPI에서 확인된 장소와 서버 경로 계산으로 완성된 일정입니다.");
        text("[data-standard]", widget.standardTotalMinutes + "분");
        text("[data-carryme]", widget.carrymeTotalMinutes + "분");
        text("[data-saving]", widget.savedMinutes + "분");
        document.querySelector("[data-summary]")?.removeAttribute("hidden");
        const days = document.querySelector("[data-days]");
        if (days) {
          days.replaceChildren(...widget.days.map((day) => {
            const section = document.createElement("section");
            section.className = "day";
            const heading = document.createElement("h2");
            heading.textContent = "Day " + day.day;
            const list = document.createElement("ul");
            day.visits.forEach((place) => {
              const item = document.createElement("li");
              item.textContent = place.title;
              list.appendChild(item);
            });
            section.append(heading, list);
            return section;
          }));
        }
        const excluded = Array.isArray(job.excludedRequestedPlaces) ? job.excludedRequestedPlaces : [];
        if (excluded.length > 0) {
          const element = document.querySelector("[data-excluded]");
          if (element) {
            element.textContent = excluded.map((item) => item.reason === "UNROUTABLE"
              ? "요청한 장소 " + item.input + "은 안전한 이동 경로를 확인하지 못해 일정에서 제외되었습니다."
              : "요청한 장소 " + item.input + "은 TourAPI에서 확인되지 않아 일정에서 제외되었습니다.").join(" ");
            element.removeAttribute("hidden");
          }
        }
        const link = document.querySelector("[data-link]");
        if (link) {
          link.href = widget.pageUrl;
          link.removeAttribute("hidden");
        }
      }

      function scheduleNext(job) {
        if (terminal) return;
        if (pendingTimer || typeof window.openai?.callTool !== "function") return;
        if (attempts >= maxAttempts || Date.now() - startedAt >= maxElapsedMs) {
          render({ status:"failed", itineraryId:job.itineraryId, message:"자동 처리 제한 안에 일정을 완성하지 못했습니다." });
          return;
        }
        const delay = Math.max(500, Math.min(2000, Number(job.retryAfterMs) || 500));
        pendingTimer = window.setTimeout(async () => {
          pendingTimer = null;
          attempts += 1;
          try {
            const result = await window.openai.callTool("get_planme_itinerary", { itineraryId: job.itineraryId });
            render(pickJob(result) || bridgeJob());
          } catch {
            render({ status:"failed", itineraryId:job.itineraryId, message:"일정 상태를 자동으로 확인하지 못했습니다." });
          }
        }, delay);
      }

      function refreshFromBridge() { render(bridgeJob()); }
      window.addEventListener("openai:set_globals", refreshFromBridge);
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (message?.jsonrpc === "2.0" && message.method === "ui/notifications/tool-result") {
          render(pickJob(message.params));
        }
      });
      refreshFromBridge();
      window.setTimeout(refreshFromBridge, 100);
      window.setTimeout(refreshFromBridge, 500);
    </script>
  </body>
</html>`;
}
