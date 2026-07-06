import { NextResponse } from "next/server";

type AutocompleteRequestBody = {
  input?: string;
  sessionToken?: string;
};

type PlacePrediction = {
  placeId?: string;
  structuredFormat?: {
    mainText?: {
      text?: string;
    };
    secondaryText?: {
      text?: string;
    };
  };
  text?: {
    text?: string;
  };
};

type PlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: PlacePrediction;
  }>;
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
 * Uses the PlanME request origin as Google referrer for referrer-restricted browser keys.
 */
function createGoogleMapsRefererHeader(requestUrl: string) {
  return { Referer: `${new URL(requestUrl).origin}/` };
}

/**
 * Proxies Google Places Autocomplete(New) so the PlanME UI can search destinations.
 */
export async function POST(request: Request) {
  const apiKey = getGoogleMapsApiKey();
  const body = (await request.json()) as AutocompleteRequestBody;
  const input = body.input?.trim() ?? "";

  if (!apiKey) {
    return NextResponse.json(
      { candidates: [], message: GOOGLE_MAPS_API_KEY_MISSING_MESSAGE },
      { status: 503 },
    );
  }

  if (input.length < 2) {
    return NextResponse.json({ candidates: [] });
  }

  // Bias the demo search around Osaka so short Korean/Japanese queries stay relevant.
  const googleResponse = await fetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      body: JSON.stringify({
        input,
        languageCode: "ko",
        locationBias: {
          circle: {
            center: { latitude: 34.6937, longitude: 135.5023 },
            radius: 50000,
          },
        },
        sessionToken: body.sessionToken,
      }),
      headers: {
        "Content-Type": "application/json",
        ...createGoogleMapsRefererHeader(request.url),
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
      },
      method: "POST",
    },
  );

  if (!googleResponse.ok) {
    const errorBody = (await googleResponse.json()) as GoogleErrorResponse;

    return NextResponse.json(
      {
        candidates: [],
        message:
          errorBody.error?.message ??
          "Google Places 검색 요청을 처리하지 못했습니다.",
      },
      { status: googleResponse.status },
    );
  }

  const data = (await googleResponse.json()) as PlacesAutocompleteResponse;
  const candidates =
    data.suggestions
      ?.map((suggestion) => suggestion.placePrediction)
      .filter((prediction): prediction is PlacePrediction => Boolean(prediction?.placeId))
      .map((prediction) => ({
        mainText:
          prediction.structuredFormat?.mainText?.text ??
          prediction.text?.text ??
          "",
        placeId: prediction.placeId ?? "",
        secondaryText: prediction.structuredFormat?.secondaryText?.text ?? "",
        text: prediction.text?.text ?? "",
      })) ?? [];

  return NextResponse.json({ candidates });
}
