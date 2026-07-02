import { ImageResponse } from "next/og";
import { getPlanmeItineraryById, type TimelineEvent } from "@planme/core";

export const size = {
  width: 768,
  height: 1120,
};

export const contentType = "image/png";

type ItineraryOgRouteContext = {
  params: Promise<{
    itineraryId: string;
  }>;
};

/**
 * Removes the optional .png suffix used to make dynamic image URLs obvious to chat clients.
 */
function normalizeItineraryIdParam(itineraryId: string): string {
  // The route still accepts the legacy suffixless URL, but GPT responses always use .png.
  return itineraryId.endsWith(".png") ? itineraryId.slice(0, -4) : itineraryId;
}

/**
 * Draws compact white line icons that do not depend on external emoji fonts.
 */
function TimelineIcon({ category }: { category: TimelineEvent["category"] }) {
  const common = {
    fill: "none",
    stroke: "white",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 4,
  };

  if (category === "arrival") {
    return (
      <svg height="36" viewBox="0 0 48 48" width="36">
        <path d="M8 28 L40 20" {...common} />
        <path d="M20 25 L12 12" {...common} />
        <path d="M28 23 L36 32" {...common} />
        <path d="M14 34 L38 34" {...common} />
      </svg>
    );
  }

  if (category === "carryme") {
    return (
      <svg height="36" viewBox="0 0 48 48" width="36">
        <path d="M7 18 H30 V34 H7 Z" {...common} />
        <path d="M30 23 H37 L42 29 V34 H30 Z" {...common} />
        <path d="M15 38 A4 4 0 1 0 15 30 A4 4 0 0 0 15 38" {...common} />
        <path d="M36 38 A4 4 0 1 0 36 30 A4 4 0 0 0 36 38" {...common} />
      </svg>
    );
  }

  if (category === "transit") {
    return (
      <svg height="36" viewBox="0 0 48 48" width="36">
        <path d="M13 10 H35 Q39 10 39 14 V34 Q39 38 35 38 H13 Q9 38 9 34 V14 Q9 10 13 10 Z" {...common} />
        <path d="M15 18 H33" {...common} />
        <path d="M16 29 H16.5" {...common} />
        <path d="M31.5 29 H32" {...common} />
        <path d="M16 42 L20 38" {...common} />
        <path d="M32 42 L28 38" {...common} />
      </svg>
    );
  }

  if (category === "meal") {
    return (
      <svg height="36" viewBox="0 0 48 48" width="36">
        <path d="M15 8 V38" {...common} />
        <path d="M9 8 V20 Q9 25 15 25 Q21 25 21 20 V8" {...common} />
        <path d="M32 8 Q39 14 34 27 V38" {...common} />
      </svg>
    );
  }

  if (category === "event") {
    return (
      <svg height="36" viewBox="0 0 48 48" width="36">
        <path d="M10 14 H38 V34 H10 Z" {...common} />
        <path d="M16 20 H32" {...common} />
        <path d="M18 28 H30" {...common} />
        <path d="M10 22 Q16 22 16 14" {...common} />
        <path d="M38 22 Q32 22 32 14" {...common} />
      </svg>
    );
  }

  return (
    <svg height="36" viewBox="0 0 48 48" width="36">
      <path d="M8 33 H40" {...common} />
      <path d="M10 18 V38" {...common} />
      <path d="M38 25 V38" {...common} />
      <path d="M10 25 H26 Q32 25 32 31 V33" {...common} />
    </svg>
  );
}

/**
 * Renders a timeline-focused dynamic PNG preview for a PlanME itinerary.
 */
export async function GET(_request: Request, context: ItineraryOgRouteContext) {
  const { itineraryId: rawItineraryId } = await context.params;
  const itineraryId = normalizeItineraryIdParam(rawItineraryId);
  const itinerary = getPlanmeItineraryById(itineraryId);

  if (!itinerary) {
    // Unknown itinerary ids should fail loudly so broken GPT image links are visible in testing.
    return new Response("Itinerary not found", { status: 404 });
  }

  const day = itinerary.days[0];

  return new ImageResponse(
    (
      <div
        style={{
          background: "#ffffff",
          color: "#172033",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          padding: "34px 40px 40px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 30,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ color: "#2563eb", fontSize: 28, fontWeight: 900 }}>PlanME</div>
            <div style={{ fontSize: 36, fontWeight: 900 }}>
              {`${itinerary.region} ${itinerary.duration}`}
            </div>
          </div>
          <div
            style={{
              background: "#ecfdf3",
              border: "2px solid #b7e4c5",
              borderRadius: 999,
              color: "#16a34a",
              fontSize: 24,
              fontWeight: 900,
              padding: "14px 22px",
            }}
          >
            {itinerary.savedDurationLabel}
          </div>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 28,
            display: "flex",
            flexDirection: "column",
            padding: "28px 0 30px",
            position: "relative",
          }}
        >
          <div
            style={{
              background: "#16a34a",
              bottom: 102,
              left: 154,
              position: "absolute",
              top: 88,
              width: 4,
            }}
          />

          {day.timeline.map((event) => (
            <div
              key={`${event.time}-${event.title}`}
              style={{
                alignItems: "center",
                display: "flex",
                minHeight: 146,
                padding: "0 32px",
                position: "relative",
              }}
            >
              <div
                style={{
                  color: "#172033",
                  fontSize: 30,
                  fontWeight: 900,
                  width: 92,
                }}
              >
                {event.time}
              </div>

              <div
                style={{
                  alignItems: "center",
                  background: event.highlight ? "#2563eb" : "#334155",
                  border: "7px solid #ffffff",
                  borderRadius: 999,
                  color: "#ffffff",
                  display: "flex",
                  fontSize: 34,
                  fontWeight: 900,
                  height: 72,
                  justifyContent: "center",
                  marginRight: 28,
                  width: 72,
                }}
              >
                <TimelineIcon category={event.category} />
              </div>

              {event.highlight ? (
                <div
                  style={{
                    alignItems: "center",
                    background: "#ecf8ef",
                    border: "2px solid #b7e4c5",
                    borderRadius: 24,
                    display: "flex",
                    flex: 1,
                    justifyContent: "space-between",
                    padding: "24px 24px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontSize: 30, fontWeight: 900 }}>{event.title}</div>
                    <div style={{ color: "#172033", fontSize: 25 }}>{event.description}</div>
                  </div>
                  <div
                    style={{
                      alignItems: "center",
                      background: "#16a34a",
                      borderRadius: 999,
                      color: "#ffffff",
                      display: "flex",
                      fontSize: 34,
                      fontWeight: 900,
                      height: 54,
                      justifyContent: "center",
                      width: 54,
                    }}
                  >
                    OK
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12 }}>
                  <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
                    <div style={{ fontSize: 32, fontWeight: 900 }}>{event.title}</div>
                    {event.savingLabel ? (
                      <div
                        style={{
                          background: "#ef4444",
                          borderRadius: 999,
                          color: "#ffffff",
                          fontSize: 24,
                          fontWeight: 900,
                          padding: "9px 18px",
                        }}
                      >
                        {event.savingLabel}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ color: "#172033", fontSize: 25 }}>{event.description}</div>
                </div>
              )}
            </div>
          ))}

          <div
            style={{
              background: "#ecf8ef",
              border: "2px solid #b7e4c5",
              borderRadius: 24,
              display: "flex",
              justifyContent: "space-between",
              margin: "28px 32px 0",
              padding: "24px 28px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ color: "#16a34a", fontSize: 25, fontWeight: 900 }}>
                CarryME 총 이동 시간(예상)
              </div>
              <div style={{ color: "#16a34a", fontSize: 38, fontWeight: 900 }}>
                {day.carryme.durationLabel}
              </div>
            </div>
            <div
              style={{
                alignItems: "center",
                background: "#ef4444",
                borderRadius: 999,
                color: "#ffffff",
                display: "flex",
                fontSize: 26,
                fontWeight: 900,
                padding: "0 28px",
              }}
            >
              {itinerary.savedDurationLabel}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
