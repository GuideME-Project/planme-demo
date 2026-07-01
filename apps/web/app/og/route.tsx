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
  const title = searchParams.get("title") ?? "PlanME 부산 BTS 공연 1박 2일 추천 일정";

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
            Standard / CarryME 동선 비교
          </div>
          <div style={{ fontSize: 68, fontWeight: 900, lineHeight: 1.12, marginTop: 20 }}>
            {title}
          </div>
          <div style={{ color: "#5b667a", fontSize: 32, marginTop: 24 }}>
            상세 일정과 지도는 PlanME 웹에서 확인하세요.
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
          planme-demo.vercel.app/itinerary/busan-bts-1d1n
        </div>
      </div>
    ),
    size,
  );
}
