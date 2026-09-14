import "server-only";

import { MAGAZINE_API_URL, MAGAZINE_PAGE_SIZE, MagazineHttpError, parseMagazinePage } from "./planme-magazine";
import type { MagazineArticle, MagazinePage } from "./planme-magazine";

const NEW_MAGAZINE_API_URL = "https://guideme.co.kr/planme-api/articles.php";
type NewMagazinePage = {
  countryCode: string;
  count: number;
  skip: number;
  take: number;
  list: (Omit<MagazineArticle, "countryCode"> & { countryCodes: string[] })[];
};

export async function fetchMagazinePage(countryCode: string, language: "ko" | "en", skip = 0): Promise<MagazinePage> {
  // Both reads share the existing eight-second request budget.
  const signal = AbortSignal.timeout(8_000);
  const apiKey = process.env.GUIDEME_MAGAZINE_API_KEY;
  if (!apiKey) throw new Error("Magazine configuration missing");
  const query = new URLSearchParams({ countryCode, skip: String(skip), take: String(MAGAZINE_PAGE_SIZE) });
  const response = await fetch(`${NEW_MAGAZINE_API_URL}?${query}`, {
    headers: { "X-GuideME-Api-Key": apiKey }, cache: "no-store", signal, redirect: "error",
  });
  if (!response.ok) throw new MagazineHttpError(response.status);
  const payload = await response.json() as { success?: boolean; data?: NewMagazinePage } | null;
  const page = payload?.data;
  if (payload?.success !== true || !page || page.countryCode !== countryCode ||
    page.skip !== skip || page.take !== MAGAZINE_PAGE_SIZE || !Array.isArray(page.list) ||
    !page.list.every(article => article && Array.isArray(article.countryCodes) &&
      article.countryCodes.includes(countryCode) && article.contentLanguage === "ko" &&
      article.articleUrl === `https://guideme.co.kr/detail.php?number=${article.articleNo}`)) {
    throw new Error("Invalid magazine response");
  }
  const normalized = parseMagazinePage(JSON.stringify({ success: true, data: {
    count: page.count,
    list: page.list.map(article => ({ articleNo: article.articleNo, countryCode,
      title: article.title, summary: article.summary, thumbnailUrl: article.thumbnailUrl,
      articleUrl: article.articleUrl, contentLanguage: article.contentLanguage })),
  } }), countryCode);
  // A page past the end still belongs to the new feed; only an empty country falls back.
  if (normalized.count > 0) return normalized;

  const oldQuery = new URLSearchParams({ countryCode, language, skip: String(skip), take: String(MAGAZINE_PAGE_SIZE) });
  const legacy = await fetch(`${MAGAZINE_API_URL}?${oldQuery}`, { cache: "no-store", signal });
  if (!legacy.ok) throw new MagazineHttpError(legacy.status);
  return parseMagazinePage(await legacy.text(), countryCode);
}
