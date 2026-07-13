/**
 * Keeps ChatGPT-facing trips within the route-provider request budget and deadline.
 * Internal draft and legacy itinerary contracts may continue to support longer trips.
 */
export const PLANME_EXTERNAL_MAX_DURATION_DAYS = 3;

export const PLANME_EXTERNAL_DURATION_ERROR_MESSAGE =
  "PlanME 일정 생성은 당일부터 2박 3일(최대 3일)까지 지원합니다. 이 범위에서 여행 기간을 알려주세요.";
