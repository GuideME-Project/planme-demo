import { NextResponse } from "next/server";

type PlaceDetailsRequestBody = {
  placeId?: string;
  sessionToken?: string;
};

type PlaceDetailsResponse = {
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type GoogleErrorResponse = {
  error?: {
    message?: string;
  };
};

const GOOGLE_MAPS_API_KEY_ENV_NAMES = [
  "PLANME_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
] as const;
const GOOGLE_MAPS_API_KEY_MISSING_MESSAGE =
  "PLANME_GOOGLE_MAPS_API_KEY 또는 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY가 설정되어 있지 않습니다.";

/**
 * Returns the server-side Google Maps API key used for Places and Routes checks.
 */
function getGoogleMapsApiKey() {
  // Some deployments still provide the browser-prefixed key name; server routes can safely reuse it.
  return GOOGLE_MAPS_API_KEY_ENV_NAMES
    .map((name) => process.env[name]?.trim() ?? "")
    .find(Boolean) ?? "";
}

/**
 * Resolves a selected Google Place ID into a display name and coordinate.
 */
export async function POST(request: Request) {
  const apiKey = getGoogleMapsApiKey();
  const body = (await request.json()) as PlaceDetailsRequestBody;
  const placeId = body.placeId?.trim() ?? "";

  if (!apiKey) {
    return NextResponse.json(
      { message: GOOGLE_MAPS_API_KEY_MISSING_MESSAGE },
      { status: 503 },
    );
  }

  if (!placeId) {
    return NextResponse.json(
      { message: "placeId가 필요합니다." },
      { status: 400 },
    );
  }

  const searchParams = new URLSearchParams({
    languageCode: "ko",
  });

  if (body.sessionToken) {
    searchParams.set("sessionToken", body.sessionToken);
  }

  const googleResponse = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${searchParams.toString()}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
      method: "GET",
    },
  );

  if (!googleResponse.ok) {
    const errorBody = (await googleResponse.json()) as GoogleErrorResponse;

    return NextResponse.json(
      {
        message:
          errorBody.error?.message ??
          "Google Places 상세 조회 요청을 처리하지 못했습니다.",
      },
      { status: googleResponse.status },
    );
  }

  const data = (await googleResponse.json()) as PlaceDetailsResponse;
  const latitude = data.location?.latitude;
  const longitude = data.location?.longitude;

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return NextResponse.json(
      { message: "선택한 장소의 좌표를 확인하지 못했습니다." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    place: {
      coordinate: { lat: latitude, lng: longitude },
      placeId: data.id ?? placeId,
      secondaryText: data.formattedAddress ?? "",
      text: data.displayName?.text ?? data.formattedAddress ?? placeId,
    },
  });
}
