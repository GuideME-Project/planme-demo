import { fetchMagazinePage, MagazineHttpError } from "@/lib/planme-magazine";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const countryCode = params.get("countryCode") ?? "";
  const language = params.get("language") ?? "ko";
  const skip = params.get("skip") ?? "0";
  const headers = { "Cache-Control": "no-store" };
  if (!/^[A-Z]{2}$/.test(countryCode) || (language !== "ko" && language !== "en") ||
    !/^\d+$/.test(skip) || !Number.isSafeInteger(Number(skip))) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  }
  try {
    return Response.json({ success: true, data: await fetchMagazinePage(countryCode, language, Number(skip)) }, { headers });
  } catch (error) {
    if (error instanceof MagazineHttpError && error.status === 400) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    }
    return Response.json({ error: "MAGAZINE_UNAVAILABLE" }, { status: 503, headers });
  }
}
