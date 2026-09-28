"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import cities from "@/lib/partners/tiqets-cities.json";
import { partnerLinks } from "./home-content";
import styles from "./partner-widget.module.css";

function WidgetFrame({ kind, city, locale }: { kind: "flight" | "tour"; city: string; locale: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(kind === "flight" ? 660 : 480);
  useEffect(() => {
    // Flight details use viewport-fixed dialogs; keep their viewport bounded.
    if (kind === "flight") return;
    const resize = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type !== "planme-partner-height" || typeof data.height !== "number" || !Number.isFinite(data.height)) return;
      setHeight(Math.max(80, Math.min(20000, data.height)));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [kind]);
  return <iframe ref={frame} className={styles.frame} style={{ height: kind === "flight" ? "clamp(620px, 75vh, 900px)" : height }}
    title={kind === "flight" ? "FlyME flight search" : "PlayME tours and tickets"}
    src={`/partner-widgets/${kind}?city=${encodeURIComponent(city)}&lang=${locale}`}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" />;
}

export function PartnerWidget({ kind }: { kind: "flight" | "tour" }) {
  const { locale } = useLocale();
  const [city, setCity] = useState("73067");
  const ko = locale === "ko";
  return <div className={styles.panel}>
    <div className={styles.heading}>
      <div>
        <h3>{kind === "flight" ? "FlyME" : "PlayME"}</h3>
        <p>{kind === "flight"
          ? (ko ? "출발지, 목적지, 날짜와 인원을 선택해 항공편을 찾아보세요." : "Choose your route, dates and passengers to find flights.")
          : (ko ? "도시를 선택하고 투어와 입장권을 둘러보세요." : "Choose a city to explore tours and tickets.")}</p>
      </div>
      {kind === "tour" && <label className={styles.city}>
        <span>{ko ? "도시" : "City"}</span>
        <select value={city} onChange={(event) => setCity(event.target.value)}>
          {cities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
    </div>
    <WidgetFrame key={`${kind}-${city}-${locale}`} kind={kind} city={city} locale={locale} />
    <div className={styles.footnote}>
      <p>{ko ? "예약과 결제는 제휴 사이트에서 진행됩니다. 제휴 링크로 예약하면 PlanME가 수수료를 받을 수 있습니다." : "Booking and payment take place on partner sites. PlanME may earn a commission from bookings through these links."}</p>
      <a href={kind === "flight" ? partnerLinks.flight : partnerLinks.tour} target="_blank" rel="sponsored noopener noreferrer">
        {kind === "flight" ? (ko ? "Aviasales에서 보기" : "View on Aviasales") : (ko ? "Tiqets에서 보기" : "View on Tiqets")}<ArrowUpRight size={16} />
      </a>
    </div>
  </div>;
}
