export const PLANME_ROLLER_GROUPS = ["STAR", "PRO"] as const;
export type PlanmeRollerGroup = (typeof PLANME_ROLLER_GROUPS)[number];

/** Only the fields the home roller cards need; roller types stay on the server. */
export type PlanmeRoller = {
  /** GuideME supporter UUID, used for the app supporter-profile link. */
  supporterId: string;
  /** GuideME app universal link to the read-only supporter profile; the GuideME API sends browsers without the app to the stores. */
  profileUrl: string;
  nickname: string;
  nation: string;
  likeCount: number;
  imageUrl: string;
};

export type PlanmeRollerCards = Record<PlanmeRollerGroup, PlanmeRoller[]>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

/** GuideME-App supporter-profile screen; isOnlyReadable=true hides the reservation request button. */
export function supporterProfileUrl(appLinkBaseUrl: string, supporterId: string): string {
  const url = new URL("/service-reservation/supporter-profile", appLinkBaseUrl);
  url.searchParams.set("id", supporterId);
  url.searchParams.set("isOnlyReadable", "true");
  return url.toString();
}

/** Validates the GuideME `{ success, data: { count, list } }` response and keeps cards in API order (cardOrder). */
export function parsePlanmeRollers(payload: unknown, appLinkBaseUrl: string): PlanmeRoller[] {
  const data = (payload as { success?: unknown; data?: { list?: unknown } } | null)?.data;
  if ((payload as { success?: unknown } | null)?.success !== true || !Array.isArray(data?.list)) {
    throw new Error("Invalid PlanME rollers response");
  }
  return data.list.flatMap((item: Record<string, unknown>) => {
    const image = isHttpUrl(item?.profileImageMediumUrl) ? item.profileImageMediumUrl : item?.profileImageUrl;
    if (typeof item?.supporterId !== "string" || !UUID_PATTERN.test(item.supporterId) ||
      typeof item.nickname !== "string" || !item.nickname.trim() || typeof item.nation !== "string" ||
      !Number.isSafeInteger(item.likeCount) || (item.likeCount as number) < 0 || !isHttpUrl(image)) return [];
    return [{ supporterId: item.supporterId, profileUrl: supporterProfileUrl(appLinkBaseUrl, item.supporterId), nickname: item.nickname.trim(), nation: item.nation.trim(), likeCount: item.likeCount as number, imageUrl: image }];
  });
}

/** 5530000 → "5.53M", 7320 → "7.32K", matching the Figma card format. */
export function formatLikeCount(value: number): string {
  const units = [[1_000_000_000, "B"], [1_000_000, "M"], [1_000, "K"]] as const;
  for (const [size, suffix] of units) {
    if (value >= size) return `${Number((value / size).toFixed(2))}${suffix}`;
  }
  return String(value);
}
