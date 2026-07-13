import type { PlanmeItinerary, TimelineEvent } from "@planme/core";
import React from "react";
import { formatRouteDuration } from "./route-providers/shared";

export type ItineraryOgDayView = {
  carrymeDurationLabel: string;
  dayLabel: string;
  endLabel: string;
  events: Array<Pick<TimelineEvent, "time" | "title">>;
  standardDurationLabel: string;
  startLabel: string;
};

export type ItineraryOgViewModel = {
  carrymeTotalLabel: string;
  days: ItineraryOgDayView[];
  duration: string;
  region: string;
  savingLabel?: string;
  standardTotalLabel: string;
};

/** Creates a compact 1–3 day model whose totals always cover every rendered day. */
export function createItineraryOgViewModel(
  itinerary: PlanmeItinerary,
): ItineraryOgViewModel {
  const days = itinerary.days.slice(0, 3);
  const standardMinutes = days.reduce(
    (total, day) => total + day.standard.durationMinutes,
    0,
  );
  const carrymeMinutes = days.reduce(
    (total, day) => total + day.carryme.durationMinutes,
    0,
  );
  const hideSavings = itinerary.savedDurationLabel === undefined ||
    days.some((day) => day.savingStatus === "hidden_estimated");
  const savingMinutes = Math.max(0, standardMinutes - carrymeMinutes);

  return {
    carrymeTotalLabel: formatRouteDuration(carrymeMinutes * 60),
    days: days.map((day, index) => {
      const timeline = day.carrymeTimeline ?? day.timeline;

      return {
        carrymeDurationLabel: formatRouteDuration(day.carryme.durationMinutes * 60),
        dayLabel: `${day.day || index + 1}일차`,
        endLabel: day.carryme.stops.at(-1)?.label ?? "도착지 확인 중",
        events: selectKeyEvents(timeline),
        standardDurationLabel: formatRouteDuration(day.standard.durationMinutes * 60),
        startLabel: day.carryme.stops[0]?.label ?? "출발지 확인 중",
      };
    }),
    duration: itinerary.duration,
    region: itinerary.region,
    savingLabel: hideSavings
      ? undefined
      : savingMinutes > 0
        ? `${formatRouteDuration(savingMinutes * 60)} 절약`
        : "시간 절약 없음",
    standardTotalLabel: formatRouteDuration(standardMinutes * 60),
  };
}

/** Keeps each OG day readable by showing departure, luggage handoff, and arrival at most. */
function selectKeyEvents(timeline: TimelineEvent[]) {
  const candidates = [
    timeline[0],
    timeline.find(
      (event) => event.eventKind === "luggage_delivery" || event.category === "carryme",
    ) ?? timeline[Math.floor(timeline.length / 2)],
    timeline.at(-1),
  ];
  const keys = new Set<string>();

  return candidates.filter((event): event is TimelineEvent => {
    if (!event) {
      return false;
    }

    const key = `${event.time}:${event.title}`;

    if (keys.has(key)) {
      return false;
    }

    keys.add(key);
    return true;
  });
}

/** Renders the shared OpenGraph card used by the image route and presentation tests. */
export function ItineraryOgPresentation({
  itinerary,
}: {
  itinerary: PlanmeItinerary;
}) {
  const view = createItineraryOgViewModel(itinerary);

  return (
    <div
      style={{
        background: "#ffffff",
        color: "#172033",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        padding: "34px 38px 36px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ color: "#2563eb", fontSize: 27, fontWeight: 900 }}>PlanME</div>
          <div style={{ fontSize: 35, fontWeight: 900 }}>
            {`${view.region} ${view.duration}`}
          </div>
        </div>
        {view.savingLabel ? (
          <div
            style={{
              background: "#ecfdf3",
              border: "2px solid #b7e4c5",
              borderRadius: 999,
              color: "#16a34a",
              display: "flex",
              fontSize: 22,
              fontWeight: 900,
              padding: "13px 19px",
            }}
          >
            {view.savingLabel}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
        <TotalCard color="#2563eb" label="Standard 전체" value={view.standardTotalLabel} />
        <TotalCard color="#16a34a" label="CarryME 전체" value={view.carrymeTotalLabel} />
      </div>

      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12 }}>
        {view.days.map((day) => (
          <div
            key={day.dayLabel}
            style={{
              background: "#f8fafc",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              display: "flex",
              flex: 1,
              flexDirection: "column",
              padding: "18px 22px",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <div style={{ color: "#2563eb", fontSize: 24, fontWeight: 900 }}>
                {day.dayLabel}
              </div>
              <div style={{ color: "#64748b", display: "flex", fontSize: 18 }}>
                {`Standard ${day.standardDurationLabel} · CarryME ${day.carrymeDurationLabel}`}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 23,
                fontWeight: 900,
                marginTop: 9,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {`${day.startLabel} → ${day.endLabel}`}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                marginTop: 12,
              }}
            >
              {day.events.map((event) => (
                <div
                  key={`${event.time}-${event.title}`}
                  style={{ alignItems: "center", display: "flex", gap: 12 }}
                >
                  <div style={{ color: "#172033", fontSize: 19, fontWeight: 900, width: 58 }}>
                    {event.time}
                  </div>
                  <div
                    style={{
                      background: "#16a34a",
                      borderRadius: 999,
                      display: "flex",
                      height: 10,
                      width: 10,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      fontSize: 19,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TotalCard({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        display: "flex",
        flex: 1,
        flexDirection: "column",
        gap: 5,
        padding: "16px 20px",
      }}
    >
      <div style={{ color, display: "flex", fontSize: 18, fontWeight: 900 }}>{label}</div>
      <div style={{ display: "flex", fontSize: 29, fontWeight: 900 }}>{value}</div>
    </div>
  );
}
