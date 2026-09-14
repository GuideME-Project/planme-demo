import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

/**
 * Generates a simple OpenGraph image for PlanME itinerary links.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const english = searchParams.get("locale") === "en";
  const title = searchParams.get("title") ?? (english ? "Start your own journey" : "나만의 여행을 시작하세요");

  return new ImageResponse(
    (
      <div
        style={{
          background: "#f4f6fb",
          color: "#172033",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: 64,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 34, fontWeight: 800 }}>PlanME</div>
          <div style={{ color: "#2563eb", fontSize: 28, fontWeight: 700 }}>
            GuideME
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ color: "#16a34a", fontSize: 30, fontWeight: 800 }}>
            {english ? "Your trip, your way" : "나만의 방식으로 떠나는 여행"}
          </div>
          <div style={{ fontSize: 68, fontWeight: 900, lineHeight: 1.12, marginTop: 20 }}>
            {title}
          </div>
          <div style={{ color: "#5b667a", fontSize: 32, marginTop: 24 }}>
            {english ? "Plan your trip with PlanME." : "PlanME에서 여행 일정을 만들어보세요."}
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            background: "#ffffff",
            border: "2px solid #d9e2f2",
            borderRadius: 18,
            display: "flex",
            fontSize: 28,
            fontWeight: 800,
            gap: 20,
            padding: "24px 28px",
            width: "auto",
          }}
        >
          {`www.planme.kr/${english ? "en" : "ko"}`}
        </div>
      </div>
    ),
    size,
  );
}
