/** A Roller's Dispatch article for the home feature card; only the fields the card shows. */
export type DispatchArticle = {
  articleNo: number;
  title: string;
  thumbnailUrl: string;
  articleUrl: string;
  /** ISO 8601 with the KST offset, e.g. 2026-09-14T13:20:00+09:00. */
  publishedAt: string;
  reporterName: string | null;
  reporterPhotoUrl: string | null;
  voteUp: number;
  voteDown: number;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Validates the new magazine `roller-dispatch.php` response `{ success, data: { list } }`.
 * Articles without an image or a valid link are skipped because the card cannot show them.
 */
export function parseDispatchArticles(payload: unknown): DispatchArticle[] {
  const data = (payload as { success?: unknown; data?: { section?: unknown; list?: unknown } } | null)?.data;
  if ((payload as { success?: unknown } | null)?.success !== true || data?.section !== "ROLLERS_DISPATCH" || !Array.isArray(data.list)) {
    throw new Error("Invalid Roller's Dispatch response");
  }
  return data.list.flatMap((item: Record<string, unknown>) => {
    const reporter = item?.reporter as { name?: unknown; photoUrl?: unknown } | null | undefined;
    if (!Number.isSafeInteger(item?.articleNo) || (item.articleNo as number) < 1 ||
      typeof item.title !== "string" || !item.title.trim() || !isHttpUrl(item.thumbnailUrl) ||
      item.articleUrl !== `https://guideme.co.kr/detail.php?number=${item.articleNo}` ||
      typeof item.publishedAt !== "string" || Number.isNaN(Date.parse(item.publishedAt)) ||
      !isCount(item.voteUp) || !isCount(item.voteDown)) return [];
    return [{
      articleNo: item.articleNo as number,
      title: item.title.trim(),
      thumbnailUrl: item.thumbnailUrl,
      articleUrl: item.articleUrl,
      publishedAt: item.publishedAt,
      reporterName: typeof reporter?.name === "string" && reporter.name.trim() ? reporter.name.trim() : null,
      reporterPhotoUrl: isHttpUrl(reporter?.photoUrl) ? reporter.photoUrl : null,
      voteUp: item.voteUp,
      voteDown: item.voteDown,
    }];
  });
}
