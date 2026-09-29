import "server-only";

import { MAGAZINE_API_URL, MAGAZINE_PAGE_SIZE, MagazineHttpError, parseMagazinePage } from "./planme-magazine";
import type { MagazineArticle, MagazinePage } from "./planme-magazine";
import { localizeMagazinePage } from "./planme-magazine-translation";

const NEW_MAGAZINE_API_URL = "https://guideme.co.kr/planme-api/articles.php";
type NewMagazinePage = {
  countryCode: string | null;
  count: number;
  skip: number;
  take: number;
  list: (Omit<MagazineArticle, "countryCode"> & { countryCodes: string[] })[];
};

// countryCode null reads the latest public articles of the new magazine without a country filter.
export async function fetchMagazinePage(countryCode: string | null, language: "ko" | "en", skip = 0): Promise<MagazinePage> {
  // Both reads share the existing eight-second request budget.
  const signal = AbortSignal.timeout(8_000);
  const apiKey = process.env.GUIDEME_MAGAZINE_API_KEY;
  if (!apiKey) throw new Error("Magazine configuration missing");
  const query = new URLSearchParams({ skip: String(skip), take: String(MAGAZINE_PAGE_SIZE) });
  if (countryCode) query.set("countryCode", countryCode);
  const response = await fetch(`${NEW_MAGAZINE_API_URL}?${query}`, {
    headers: { "X-GuideME-Api-Key": apiKey }, cache: "no-store", signal, redirect: "error",
  });
  if (!response.ok) throw new MagazineHttpError(response.status);
  const payload = await response.json() as { success?: boolean; data?: NewMagazinePage } | null;
  const page = payload?.data;
  if (payload?.success !== true || !page || page.countryCode !== countryCode ||
    page.skip !== skip || page.take !== MAGAZINE_PAGE_SIZE || !Array.isArray(page.list) ||
    !page.list.every(article => article && Array.isArray(article.countryCodes) &&
      (countryCode === null || article.countryCodes.includes(countryCode)) && article.contentLanguage === "ko" &&
      article.articleUrl === `https://guideme.co.kr/detail.php?number=${article.articleNo}`)) {
    throw new Error("Invalid magazine response");
  }
  const normalized = parseMagazinePage(JSON.stringify({ success: true, data: {
    count: page.count,
    list: page.list.map(article => ({ articleNo: article.articleNo, countryCode,
      title: article.title, summary: article.summary, thumbnailUrl: article.thumbnailUrl,
      articleUrl: article.articleUrl, contentLanguage: article.contentLanguage })),
  } }), countryCode);
  // A page past the end still belongs to the new feed; only an empty feed falls back.
  if (normalized.count > 0) return localizeMagazinePage(normalized, language);

  const oldQuery = new URLSearchParams({ language, skip: String(skip), take: String(MAGAZINE_PAGE_SIZE) });
  if (countryCode) oldQuery.set("countryCode", countryCode);
  const legacy = await fetch(`${MAGAZINE_API_URL}?${oldQuery}`, { cache: "no-store", signal });
  // A legacy API release without the unfiltered query answers 400; keep the empty new feed instead of failing.
  if (countryCode === null && legacy.status === 400) return normalized;
  if (!legacy.ok) throw new MagazineHttpError(legacy.status);
  return localizeMagazinePage(parseMagazinePage(await legacy.text(), countryCode), language);
}
