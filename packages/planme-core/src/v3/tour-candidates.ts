import {
  PLANME_V3_ALLOWED_CONTENT_TYPE_IDS,
  type AllowedTourContentTypeId,
  type TourPlaceSnapshot,
} from "./contracts.js";

export type TourApiCandidateRecord = {
  contentid?: string | number;
  contenttypeid?: string | number;
  title?: string;
  mapx?: string | number;
  mapy?: string | number;
  addr1?: string;
  lDongRegnCd?: string | number;
  lDongSignguCd?: string | number;
  eventstartdate?: string | number;
  eventenddate?: string | number;
};

export type NormalizeTourCandidatesOptions = {
  fetchedAt: string;
  cacheStatus?: "fresh" | "stale";
  expectedContentTypeId?: AllowedTourContentTypeId;
  expectedRegionCode?: string;
  expectedDistrictCode?: string;
  travelStartDate?: string;
  travelEndDate?: string;
  requestedPlaces?: string[];
  preferences?: string[];
  limitPerContentType?: number;
};

export type SelectTourCandidatesOptions = Pick<
  NormalizeTourCandidatesOptions,
  | "expectedDistrictCode"
  | "requestedPlaces"
  | "preferences"
  | "limitPerContentType"
>;

// The initial AI candidate cap is 30 places per content type.
export const PLANME_V3_CANDIDATE_LIMIT_PER_CONTENT_TYPE = 30;

const ALLOWED_CONTENT_TYPES = new Set<number>(
  PLANME_V3_ALLOWED_CONTENT_TYPE_IDS,
);

export function normalizeTourCandidates(
  records: TourApiCandidateRecord[],
  options: NormalizeTourCandidatesOptions,
): TourPlaceSnapshot[] {
  const candidates = records.flatMap((record) => {
    const candidate = normalizeTourCandidate(record, options);
    return candidate ? [candidate] : [];
  });
  return selectTourCandidates(candidates, options);
}

export function selectTourCandidates(
  candidates: TourPlaceSnapshot[],
  options: SelectTourCandidatesOptions = {},
): TourPlaceSnapshot[] {
  const requestedTitles = new Set(
    (options.requestedPlaces ?? []).map(normalizeComparableTitle).filter(Boolean),
  );
  const preferences = (options.preferences ?? [])
    .map((value) => value.trim().toLocaleLowerCase("ko"))
    .filter(Boolean);
  const byStableId = new Map<string, TourPlaceSnapshot>();

  for (const candidate of candidates) {
    const stableId = `${candidate.contentTypeId}:${candidate.contentId}`;
    if (!byStableId.has(stableId)) {
      byStableId.set(stableId, candidate);
    }
  }

  const grouped = new Map<AllowedTourContentTypeId, TourPlaceSnapshot[]>();
  for (const candidate of byStableId.values()) {
    const group = grouped.get(candidate.contentTypeId) ?? [];
    group.push(candidate);
    grouped.set(candidate.contentTypeId, group);
  }

  const limit = normalizeLimit(options.limitPerContentType);
  const result: TourPlaceSnapshot[] = [];

  for (const contentTypeId of PLANME_V3_ALLOWED_CONTENT_TYPE_IDS) {
    const candidates = grouped.get(contentTypeId) ?? [];
    candidates.sort((left, right) =>
      compareCandidates(left, right, {
        expectedDistrictCode: options.expectedDistrictCode,
        preferences,
        requestedTitles,
      }),
    );
    result.push(...candidates.slice(0, limit));
  }

  return result;
}

export function normalizeTourCandidate(
  record: TourApiCandidateRecord,
  options: NormalizeTourCandidatesOptions,
): TourPlaceSnapshot | null {
  const contentId = normalizeScalar(record.contentid);
  const rawContentTypeId = Number(record.contenttypeid);
  const title = normalizeTourTitle(record.title);
  const lng = Number(record.mapx);
  const lat = Number(record.mapy);
  const regionCode = normalizeScalar(record.lDongRegnCd);
  const districtCode = normalizeScalar(record.lDongSignguCd);

  if (
    !contentId ||
    !title ||
    !isAllowedContentTypeId(rawContentTypeId) ||
    (options.expectedContentTypeId !== undefined &&
      rawContentTypeId !== options.expectedContentTypeId) ||
    !isValidCoordinate(lat, lng) ||
    (options.expectedRegionCode && regionCode !== options.expectedRegionCode) ||
    (options.expectedDistrictCode && districtCode !== options.expectedDistrictCode) ||
    !isFestivalInTravelWindow(record, rawContentTypeId, options)
  ) {
    return null;
  }

  return {
    contentId,
    contentTypeId: rawContentTypeId,
    title,
    coordinate: { lat, lng },
    address: normalizeOptionalText(record.addr1),
    regionCode,
    districtCode,
    fetchedAt: options.fetchedAt,
    cacheStatus: options.cacheStatus ?? "fresh",
    source: "tourapi",
  };
}

export function normalizeTourTitle(value: string | undefined) {
  return value?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

export function isAllowedContentTypeId(
  value: number,
): value is AllowedTourContentTypeId {
  return Number.isInteger(value) && ALLOWED_CONTENT_TYPES.has(value);
}

function isValidCoordinate(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function isFestivalInTravelWindow(
  record: TourApiCandidateRecord,
  contentTypeId: AllowedTourContentTypeId,
  options: NormalizeTourCandidatesOptions,
) {
  if (contentTypeId !== 15) {
    return true;
  }

  if (!options.travelStartDate || !options.travelEndDate) {
    return false;
  }

  const eventStartDate = normalizeCompactDate(record.eventstartdate);
  const eventEndDate = normalizeCompactDate(record.eventenddate);
  const travelStartDate = options.travelStartDate.replaceAll("-", "");
  const travelEndDate = options.travelEndDate.replaceAll("-", "");

  return Boolean(
    eventStartDate &&
      eventEndDate &&
      eventStartDate <= travelEndDate &&
      eventEndDate >= travelStartDate,
  );
}

function compareCandidates(
  left: TourPlaceSnapshot,
  right: TourPlaceSnapshot,
  context: {
    requestedTitles: Set<string>;
    expectedDistrictCode?: string;
    preferences: string[];
  },
) {
  const requestedDifference =
    Number(context.requestedTitles.has(normalizeComparableTitle(right.title))) -
    Number(context.requestedTitles.has(normalizeComparableTitle(left.title)));
  if (requestedDifference !== 0) {
    return requestedDifference;
  }

  const districtDifference = context.expectedDistrictCode
    ? Number(right.districtCode === context.expectedDistrictCode) -
      Number(left.districtCode === context.expectedDistrictCode)
    : 0;
  if (districtDifference !== 0) {
    return districtDifference;
  }

  const preferenceDifference =
    preferenceScore(right.title, context.preferences) -
    preferenceScore(left.title, context.preferences);
  if (preferenceDifference !== 0) {
    return preferenceDifference;
  }

  const completenessDifference =
    Number(Boolean(right.address)) - Number(Boolean(left.address));
  if (completenessDifference !== 0) {
    return completenessDifference;
  }

  const titleDifference = left.title.localeCompare(right.title, "ko");
  return titleDifference !== 0
    ? titleDifference
    : left.contentId.localeCompare(right.contentId);
}

function preferenceScore(title: string, preferences: string[]) {
  const comparableTitle = title.toLocaleLowerCase("ko");
  return preferences.filter((preference) => comparableTitle.includes(preference)).length;
}

function normalizeComparableTitle(value: string) {
  return normalizeTourTitle(value).toLocaleLowerCase("ko");
}

function normalizeScalar(value: string | number | undefined) {
  const normalized = value === undefined ? "" : String(value).trim();
  return normalized || undefined;
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeCompactDate(value: string | number | undefined) {
  const normalized = normalizeScalar(value);
  return normalized && /^\d{8}$/.test(normalized) ? normalized : undefined;
}

function normalizeLimit(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? Math.min(value, PLANME_V3_CANDIDATE_LIMIT_PER_CONTENT_TYPE)
    : PLANME_V3_CANDIDATE_LIMIT_PER_CONTENT_TYPE;
}
