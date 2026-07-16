import {
  normalizeTourTitle,
  recordPlanmeUsageSafely,
  type AllowedTourContentTypeId,
  type PlanmeUsageRecorder,
  type TourApiCandidateRecord,
} from "@planme/core";

const TOUR_API_ORIGIN = "https://apis.data.go.kr";
const TOUR_API_BASE_PATH = "/B551011/KorService2";
const TOUR_API_DEFAULT_PAGE_SIZE = 100;
// Bound a single content-type lookup to protect the development quota.
const TOUR_API_DEFAULT_MAX_PAGES = 3;

type TourApiHeader = {
  resultCode?: string;
  resultMsg?: string;
};

type TourApiBody<Item> = {
  items?: { item?: Item | Item[] } | "";
  numOfRows?: number;
  pageNo?: number;
  totalCount?: number;
};

type TourApiEnvelope<Item> = {
  response?: {
    header?: TourApiHeader;
    body?: TourApiBody<Item>;
  };
};

type TourApiLegalDongRecord = {
  name?: string;
  code?: string | number;
  lDongRegnCd?: string | number;
  lDongRegnNm?: string;
  lDongSignguCd?: string | number;
  lDongSignguNm?: string;
};

export type TourRegion = {
  regionCode: string;
  regionName: string;
  districtCode?: string;
  districtName?: string;
};

export type TourDestinationResolution = {
  region: TourRegion;
  place?: TourApiCandidateRecord;
};

export type TourCandidateQuery = {
  region: TourRegion;
  contentTypeId: AllowedTourContentTypeId;
  travelStartDate?: string;
  travelEndDate?: string;
  pageSize?: number;
  maxPages?: number;
};

export type TourCandidateQueryResult =
  | {
      status: "success";
      records: TourApiCandidateRecord[];
      totalCount: number;
    }
  | { status: "empty"; records: []; totalCount: 0 }
  | {
      status: "failure";
      errorCode: string;
      retriable: boolean;
    };

export type TourApiClientOptions = {
  serviceKey?: string;
  fetchImpl?: typeof fetch;
  usageRecorder?: PlanmeUsageRecorder;
};

export class TourApiConfigurationError extends Error {
  constructor() {
    super("PLANME_V3_TOUR_API_CONFIGURATION_MISSING");
    this.name = "TourApiConfigurationError";
  }
}

export function createTourApiClient(options: TourApiClientOptions = {}) {
  const serviceKey =
    options.serviceKey?.trim() || process.env.TOUR_API_SERVICE_KEY?.trim() || "";
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!serviceKey) {
    throw new TourApiConfigurationError();
  }

  return {
    resolveRegion(destination: string, signal?: AbortSignal) {
      return resolveTourRegion({
        destination,
        fetchImpl,
        serviceKey,
        signal,
        usageRecorder: options.usageRecorder,
      });
    },
    resolveDestination(destination: string, signal?: AbortSignal) {
      return resolveTourDestination({
        destination,
        fetchImpl,
        serviceKey,
        signal,
        usageRecorder: options.usageRecorder,
      });
    },
    listCandidates(query: TourCandidateQuery, signal?: AbortSignal) {
      return listTourCandidates({
        fetchImpl,
        query,
        serviceKey,
        signal,
        usageRecorder: options.usageRecorder,
      });
    },
  };
}

async function resolveTourDestination(input: {
  destination: string;
  fetchImpl: typeof fetch;
  serviceKey: string;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}): Promise<TourDestinationResolution | null> {
  const regions = await requestTourApi<TourApiLegalDongRecord>({
    fetchImpl: input.fetchImpl,
    operation: "ldongCode2",
    params: {
      lDongListYn: "Y",
      numOfRows: "1000",
      pageNo: "1",
    },
    serviceKey: input.serviceKey,
    signal: input.signal,
    usageRecorder: input.usageRecorder,
  });
  if (regions.status !== "success") {
    return null;
  }

  const directRegion = matchTourRegion(input.destination, regions.items);
  if (directRegion) {
    return { region: directRegion };
  }

  const places = await requestTourApi<TourApiCandidateRecord>({
    fetchImpl: input.fetchImpl,
    operation: "searchKeyword2",
    params: {
      arrange: "A",
      keyword: input.destination,
      numOfRows: "20",
      pageNo: "1",
    },
    serviceKey: input.serviceKey,
    signal: input.signal,
    usageRecorder: input.usageRecorder,
  });
  if (places.status !== "success") {
    return null;
  }

  const expectedTitle = comparableTourTitle(input.destination);
  const exactMatches = places.items.filter(
    (place) => comparableTourTitle(place.title ?? "") === expectedTitle,
  );
  const aliasMatches = exactMatches.length === 0
    ? places.items.filter(
        (place) => comparableTourAliasTitle(place.title ?? "") === expectedTitle,
      )
    : [];
  const matches = exactMatches.length > 0 ? exactMatches : aliasMatches;
  if (matches.length !== 1) {
    return null;
  }
  const place = matches[0];
  const region = place ? matchTourRegionCodes(place, regions.items) : null;
  if (!place || !region) {
    return null;
  }
  return { region, place };
}

async function resolveTourRegion(input: {
  destination: string;
  fetchImpl: typeof fetch;
  serviceKey: string;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}): Promise<TourRegion | null> {
  const response = await requestTourApi<TourApiLegalDongRecord>({
    fetchImpl: input.fetchImpl,
    operation: "ldongCode2",
    params: {
      lDongListYn: "Y",
      numOfRows: "1000",
      pageNo: "1",
    },
    serviceKey: input.serviceKey,
    signal: input.signal,
    usageRecorder: input.usageRecorder,
  });

  if (response.status !== "success") {
    return null;
  }

  return matchTourRegion(input.destination, response.items);
}

async function listTourCandidates(input: {
  fetchImpl: typeof fetch;
  query: TourCandidateQuery;
  serviceKey: string;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}): Promise<TourCandidateQueryResult> {
  const startedAt = Date.now();
  if (
    input.query.contentTypeId === 15 &&
    (!input.query.travelStartDate || !input.query.travelEndDate)
  ) {
    logCandidatePerformance(input.query.contentTypeId, startedAt, 0, "empty");
    return { status: "empty", records: [], totalCount: 0 };
  }

  const operation = getCandidateOperation(input.query.contentTypeId);
  const pageSize = normalizePageSize(input.query.pageSize);
  const maxPages = normalizeMaxPages(input.query.maxPages);
  const records: TourApiCandidateRecord[] = [];
  let totalCount = 0;
  let requestedPages = 0;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    requestedPages += 1;
    const response = await requestTourApi<TourApiCandidateRecord>({
      fetchImpl: input.fetchImpl,
      operation,
      params: createCandidateParams(input.query, pageNo, pageSize),
      serviceKey: input.serviceKey,
      signal: input.signal,
      usageRecorder: input.usageRecorder,
    });

    if (response.status === "failure") {
      logCandidatePerformance(
        input.query.contentTypeId,
        startedAt,
        requestedPages,
        "failure",
      );
      return response;
    }

    if (response.status === "empty") {
      break;
    }

    totalCount = response.totalCount;
    records.push(...response.items);

    if (records.length >= totalCount || response.items.length < pageSize) {
      break;
    }
  }

  const result: TourCandidateQueryResult = records.length === 0
    ? { status: "empty", records: [], totalCount: 0 }
    : { status: "success", records, totalCount };
  logCandidatePerformance(
    input.query.contentTypeId,
    startedAt,
    requestedPages,
    result.status,
  );
  return result;
}

function logCandidatePerformance(
  contentTypeId: AllowedTourContentTypeId,
  startedAt: number,
  requestedPages: number,
  outcome: "success" | "empty" | "failure",
) {
  console.info("PlanME V3 TourAPI candidate performance", {
    contentTypeId,
    durationMs: Date.now() - startedAt,
    requestedPages,
    outcome,
  });
}

async function requestTourApi<Item>(input: {
  fetchImpl: typeof fetch;
  operation: string;
  params: Record<string, string>;
  serviceKey: string;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}): Promise<
  | { status: "success"; items: Item[]; totalCount: number }
  | { status: "empty" }
  | { status: "failure"; errorCode: string; retriable: boolean }
> {
  const url = new URL(`${TOUR_API_BASE_PATH}/${input.operation}`, TOUR_API_ORIGIN);
  const params = {
    MobileApp: "PlanME",
    MobileOS: "ETC",
    _type: "json",
    ...input.params,
    serviceKey: decodeServiceKey(input.serviceKey),
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  let response: Response;
  try {
    await recordPlanmeUsageSafely(input.usageRecorder, "tourapi_request");
    response = await input.fetchImpl(url, { method: "GET", signal: input.signal });
  } catch {
    return { status: "failure", errorCode: "TOURAPI_NETWORK", retriable: true };
  }

  if (!response.ok) {
    return {
      status: "failure",
      errorCode: `TOURAPI_HTTP_${response.status}`,
      retriable: response.status === 408 || response.status === 429 || response.status >= 500,
    };
  }

  let payload: TourApiEnvelope<Item>;
  try {
    payload = JSON.parse(await response.text()) as TourApiEnvelope<Item>;
  } catch {
    return { status: "failure", errorCode: "TOURAPI_INVALID_JSON", retriable: false };
  }

  const resultCode = payload.response?.header?.resultCode ?? "TOURAPI_INVALID_BODY";
  if (resultCode !== "0000") {
    return {
      status: "failure",
      errorCode: `TOURAPI_RESULT_${resultCode}`,
      retriable: resultCode === "22" || resultCode === "99",
    };
  }

  const body = payload.response?.body;
  const item = body?.items && typeof body.items === "object" ? body.items.item : undefined;
  const items = item === undefined ? [] : Array.isArray(item) ? item : [item];

  return items.length === 0
    ? { status: "empty" }
    : { status: "success", items, totalCount: body?.totalCount ?? items.length };
}

function matchTourRegion(
  destination: string,
  records: TourApiLegalDongRecord[],
): TourRegion | null {
  const comparableDestination = normalizeRegionName(destination);
  const compactDestination = compactRegionName(destination);
  const normalized = records.flatMap((record) => {
    const regionCode = normalizeScalar(record.lDongRegnCd);
    const regionName = record.lDongRegnNm?.trim();

    if (!regionCode || !regionName) {
      return [];
    }

    const districtCode = normalizeScalar(record.lDongSignguCd);
    const districtName = record.lDongSignguNm?.trim() || undefined;

    return [
      {
        regionCode,
        regionName,
        ...(districtCode ? { districtCode } : {}),
        ...(districtName ? { districtName } : {}),
      },
    ];
  });
  const candidates = normalized.map((region) => {
    const regionName = normalizeRegionName(region.regionName);
    const districtName = normalizeRegionName(region.districtName ?? "");
    const compactDistrictName = compactRegionName(region.districtName ?? "");
    return {
      ...region,
      regionMatch: Boolean(
        regionName &&
          (comparableDestination.includes(regionName) ||
            regionName.includes(comparableDestination)),
      ),
      districtMatch: Boolean(
        districtName &&
          ((compactDistrictName && compactDestination.endsWith(compactDistrictName)) ||
            (districtName.length >= 2 && comparableDestination.endsWith(districtName))),
      ),
    };
  });
  const hasParentRegion = candidates.some((candidate) => candidate.regionMatch);
  const matchedParentRegionCodes = new Set(
    candidates
      .filter((candidate) => candidate.regionMatch)
      .map((candidate) => candidate.regionCode),
  );
  if (matchedParentRegionCodes.size > 1) {
    return null;
  }
  const parentCandidates = hasParentRegion
    ? candidates.filter((candidate) => candidate.regionMatch)
    : candidates.filter((candidate) => candidate.districtMatch);
  const hasDistrictWithinParent = parentCandidates.some(
    (candidate) => candidate.districtMatch,
  );
  if (hasParentRegion && !hasDistrictWithinParent) {
    const parent = parentCandidates[0];
    return parent
      ? { regionCode: parent.regionCode, regionName: parent.regionName }
      : null;
  }
  const regionOnlyCandidates = parentCandidates.filter(
    (candidate) => !candidate.districtCode,
  );
  const matches = hasDistrictWithinParent
    ? parentCandidates.filter((candidate) => candidate.districtMatch)
    : regionOnlyCandidates.length > 0
      ? regionOnlyCandidates
      : parentCandidates;

  if (!hasParentRegion) {
    const matchedRegionCodes = new Set(matches.map((match) => match.regionCode));
    if (matchedRegionCodes.size > 1) {
      return null;
    }
  }

  matches.sort((left, right) => {
    if (left.districtMatch !== right.districtMatch) {
      return Number(right.districtMatch) - Number(left.districtMatch);
    }
    if (!left.districtMatch && Boolean(left.districtCode) !== Boolean(right.districtCode)) {
      return Number(Boolean(left.districtCode)) - Number(Boolean(right.districtCode));
    }
    const districtLengthDifference =
      (right.districtName?.length ?? 0) - (left.districtName?.length ?? 0);
    return districtLengthDifference !== 0
      ? districtLengthDifference
      : left.regionCode.localeCompare(right.regionCode);
  });

  const match = matches[0];
  if (!match) {
    return null;
  }
  return {
    regionCode: match.regionCode,
    regionName: match.regionName,
    ...(match.districtCode ? { districtCode: match.districtCode } : {}),
    ...(match.districtName ? { districtName: match.districtName } : {}),
  };
}

function matchTourRegionCodes(
  place: TourApiCandidateRecord,
  records: TourApiLegalDongRecord[],
): TourRegion | null {
  const regionCode = normalizeScalar(place.lDongRegnCd);
  const districtCode = normalizeScalar(place.lDongSignguCd);
  if (!regionCode || !districtCode) {
    return null;
  }
  const district = records.find(
    (record) => normalizeScalar(record.lDongRegnCd) === regionCode &&
      normalizeScalar(record.lDongSignguCd) === districtCode,
  );
  const regionName = district?.lDongRegnNm?.trim();
  const districtName = district?.lDongSignguNm?.trim();
  return regionName && districtName
    ? { regionCode, regionName, districtCode, districtName }
    : null;
}

function createCandidateParams(
  query: TourCandidateQuery,
  pageNo: number,
  pageSize: number,
) {
  const params: Record<string, string> = {
    arrange: "A",
    lDongRegnCd: query.region.regionCode,
    numOfRows: String(pageSize),
    pageNo: String(pageNo),
  };

  if (query.contentTypeId !== 32) {
    params.contentTypeId = String(query.contentTypeId);
  }

  if (query.region.districtCode) {
    params.lDongSignguCd = query.region.districtCode;
  }

  if (query.contentTypeId === 15 && query.travelStartDate && query.travelEndDate) {
    params.eventStartDate = query.travelStartDate.replaceAll("-", "");
    params.eventEndDate = query.travelEndDate.replaceAll("-", "");
  }

  return params;
}

function getCandidateOperation(contentTypeId: AllowedTourContentTypeId) {
  if (contentTypeId === 32) {
    return "searchStay2";
  }
  if (contentTypeId === 15) {
    return "searchFestival2";
  }
  return "areaBasedList2";
}

function decodeServiceKey(serviceKey: string) {
  try {
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
}

function normalizePageSize(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? Math.min(value, TOUR_API_DEFAULT_PAGE_SIZE)
    : TOUR_API_DEFAULT_PAGE_SIZE;
}

function normalizeMaxPages(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? Math.min(value, TOUR_API_DEFAULT_MAX_PAGES)
    : TOUR_API_DEFAULT_MAX_PAGES;
}

function normalizeRegionName(value: string) {
  const trimmed = value.trim();
  const endsWithCompositeAdministrativeSuffix =
    /(특별자치도|특별자치시|광역시|특별시)$/.test(trimmed);
  const normalized = trimmed
    .replace(/특별자치도|특별자치시|광역시|특별시/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (endsWithCompositeAdministrativeSuffix || normalized === "대구") {
    return normalized;
  }
  return normalized.replace(/(도|시|군|구)$/g, "");
}

function compactRegionName(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function comparableTourTitle(value: string) {
  return normalizeTourTitle(value).replace(/\s+/g, "").toLocaleLowerCase("ko");
}

function comparableTourAliasTitle(value: string) {
  return comparableTourTitle(value).replace(/어뮤즈먼트$/u, "");
}

function normalizeScalar(value: string | number | undefined) {
  const normalized = value === undefined ? "" : String(value).trim();
  return normalized || undefined;
}
