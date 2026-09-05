import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { autocompletePlanmePlaces, isPlanmePlacesSessionToken } from "@/lib/planme-places";
import { consumePlanmeAutocompleteRateLimit, getOrCreatePlanmeSearchSessionId } from "@/lib/planme-search-rate-limit";

export async function POST(request: Request) {
  const reply = (message: string, status: number) => NextResponse.json({ suggestions: [], message }, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return reply("이 페이지에서 장소를 다시 검색해 주세요.", 403);
  }
  let body: { query?: string; sessionToken?: string };
  try {
    if (Number(request.headers.get("content-length")) > 4096) return reply("검색어를 확인해 주세요.", 400);
    const text = await request.text();
    if (text.length > 4096) return reply("검색어를 확인해 주세요.", 400);
    body = JSON.parse(text) as typeof body;
  } catch {
    return reply("검색어를 확인해 주세요.", 400);
  }
  if (typeof body?.query !== "string" || body.query.trim().length < 2 || body.query.trim().length > 100 ||
    typeof body.sessionToken !== "string" || !isPlanmePlacesSessionToken(body.sessionToken)) {
    return reply("장소를 두 글자 이상 입력해 주세요.", 400);
  }
  try {
    const sessionId = getOrCreatePlanmeSearchSessionId(await cookies());
    const limit = await consumePlanmeAutocompleteRateLimit(sessionId);
    if (!limit.allowed) return reply("후보 조회가 많습니다. 직접 입력해 검색하거나 잠시 후 다시 시도해 주세요.", 429);
    const result = await autocompletePlanmePlaces(body.query.trim(), body.sessionToken, request.signal);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return reply("후보를 불러오지 못했습니다. 직접 입력해 검색할 수 있어요.", 503);
  }
}
