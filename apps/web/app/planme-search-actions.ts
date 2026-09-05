"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  consumePlanmeSearchRateLimit,
  getOrCreatePlanmeSearchSessionId,
} from "@/lib/planme-search-rate-limit";
import { isPlanmeProgressPreviewEnabled } from "@/lib/planme-progress-preview";
import { getPlanmeV3Runtime } from "@/lib/planme-v3/runtime";
import { resolvePlanmeGlobalTrip, type PlanmeGlobalTripPreparation } from "@/lib/planme-global-trip";
import { isPlanmePlaceId, isPlanmePlacesSessionToken, resolveSelectedPlanmePlace } from "@/lib/planme-places";
import { resolveSelectedDomesticDestination } from "@/lib/planme-selected-destination";

const MAX_LOCATION_LENGTH = 100;
const GENERATION_DEADLINE_MS = 45_000;

export type PlanmeSearchActionState = {
  submissionId?: string;
  globalPreparation?: PlanmeGlobalTripPreparation & {
    submissionId: string;
  };
  error?: string;
  fieldErrors?: Partial<
    Record<"destination" | "origin" | "durationDays" | "transportMode", string>
  >;
};

export async function startPlanmeSearchAction(
  _previousState: PlanmeSearchActionState,
  formData: FormData,
): Promise<PlanmeSearchActionState> {
  const destination = readText(formData, "destination");
  const origin = readText(formData, "origin");
  const durationDays = Number(readText(formData, "durationDays"));
  const transportMode = readText(formData, "transportMode");
  const submissionId = readText(formData, "submissionId");
  const originPlaceId = readText(formData, "originPlaceId");
  const destinationPlaceId = readText(formData, "destinationPlaceId");
  const originSessionToken = readText(formData, "originSessionToken");
  const destinationSessionToken = readText(formData, "destinationSessionToken");
  const fieldErrors: NonNullable<PlanmeSearchActionState["fieldErrors"]> = {};

  if (!destination || destination.length > MAX_LOCATION_LENGTH) {
    fieldErrors.destination = "목적지를 입력해 주세요.";
  }
  if (!origin || origin.length > MAX_LOCATION_LENGTH) {
    fieldErrors.origin = "출발지를 입력해 주세요.";
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 14) {
    fieldErrors.durationDays = "여행 기간을 선택해 주세요.";
  }
  if (transportMode !== "drive" && transportMode !== "transit") {
    fieldErrors.transportMode = "이동수단을 선택해 주세요.";
  }
  if ((originPlaceId && !isPlanmePlaceId(originPlaceId)) || (originSessionToken && !isPlanmePlacesSessionToken(originSessionToken))) {
    fieldErrors.origin = "출발지를 다시 선택하거나 직접 입력해 주세요.";
  }
  if ((destinationPlaceId && !isPlanmePlaceId(destinationPlaceId)) || (destinationSessionToken && !isPlanmePlacesSessionToken(destinationSessionToken))) {
    fieldErrors.destination = "목적지를 다시 선택하거나 직접 입력해 주세요.";
  }
  if (!submissionId || submissionId.length > 128) {
    return { submissionId, error: "검색 요청을 다시 시도해 주세요." };
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { submissionId, fieldErrors };
  }
  if (transportMode !== "drive" && transportMode !== "transit") {
    return { submissionId, fieldErrors: { transportMode: "이동수단을 선택해 주세요." } };
  }

  try {
    const cookieStore = await cookies();
    const sessionId = getOrCreatePlanmeSearchSessionId(cookieStore);
    const rateLimit = await consumePlanmeSearchRateLimit(sessionId);

    if (!rateLimit.allowed) {
      return { submissionId, error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    console.error("PlanME web search rate limit failed", message);
    return { submissionId, error: "현재 검색 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }

  const [selectedOrigin, selectedDestination] = await Promise.all([
    originPlaceId ? resolveSelectedPlanmePlace(originPlaceId, originSessionToken) : null,
    destinationPlaceId ? resolveSelectedPlanmePlace(destinationPlaceId, destinationSessionToken) : null,
  ]);
  if (originPlaceId && !selectedOrigin) fieldErrors.origin = "선택한 출발지를 확인하지 못했습니다. 다시 선택하거나 직접 입력해 주세요.";
  if (destinationPlaceId && !selectedDestination) fieldErrors.destination = "선택한 목적지를 확인하지 못했습니다. 다시 선택하거나 직접 입력해 주세요.";
  if (Object.keys(fieldErrors).length) return { submissionId, fieldErrors };
  const globalPreparation = await resolvePlanmeGlobalTrip({ origin, destination, selectedOrigin, selectedDestination });
  if (globalPreparation) {
    return {
      submissionId,
      globalPreparation: {
        submissionId,
        ...globalPreparation,
      },
    };
  }

  const domesticSelection = selectedDestination ? await resolveSelectedDomesticDestination(selectedDestination) : null;
  if (selectedDestination && !domesticSelection) {
    return { submissionId, fieldErrors: { destination: "선택한 장소를 국내 일정에 연결하지 못했습니다. 도시·지역을 선택하거나 직접 입력해 주세요." } };
  }

  let result;
  try {
    const runtime = getPlanmeV3Runtime();
    result = await runtime.startItinerary(
      {
        destination: domesticSelection?.searchText ?? destination,
        origin: selectedOrigin?.searchText ?? origin,
        durationDays,
        transportMode,
      },
      submissionId,
    );

    if (result.status === "processing") {
      if (!isPlanmeProgressPreviewEnabled()) {
        result = await runtime.runUntilTerminal(
          result.itineraryId,
          Date.now() + GENERATION_DEADLINE_MS,
        );
      }
    }
  } catch (error) {
    console.error("PlanME web search failed", error);
    return { submissionId, error: "일정 생성에 실패했습니다. 다시 시도해 주세요." };
  }

  if (result?.status === "processing" && isPlanmeProgressPreviewEnabled()) {
    redirect(`/itinerary/${encodeURIComponent(result.itineraryId)}`);
  }
  if (result?.status === "ready") {
    redirect(`/itinerary/${encodeURIComponent(result.itineraryId)}`);
  }

  if (result?.status === "invalid") {
    return { submissionId, error: "입력값을 확인해 주세요." };
  }
  if (result?.status === "idempotency_conflict") {
    return { submissionId, error: "입력값이 변경되었습니다. 다시 검색해 주세요." };
  }

  return { submissionId, error: "일정 생성에 실패했습니다. 다시 시도해 주세요." };
}

function readText(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}
