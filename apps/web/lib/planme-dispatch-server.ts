import "server-only";

import type { Locale } from "./i18n/routing";
import { parseDispatchArticles, type DispatchArticle } from "./planme-dispatch";
import { localizeMagazinePage } from "./planme-magazine-translation";

// New magazine (guideme.co.kr /www/news/planme-api/roller-dispatch.php): section thread 11, newest first.
const DISPATCH_API_URL = "https://guideme.co.kr/planme-api/roller-dispatch.php";
const DISPATCH_TAKE = 5;
const DISPATCH_TIMEOUT_MS = 3_000;
// A cold English translation can take far longer than the home page should wait; the static card is shown meanwhile
// and the translation keeps running so the next request hits its cache.
const TRANSLATION_WAIT_MS = 4_000;
const DISPATCH_REVALIDATE_SECONDS = 300;

async function englishTitles(articles: DispatchArticle[]): Promise<DispatchArticle[]> {
  const translation = localizeMagazinePage({
    count: articles.length,
    list: articles.map(article => ({ articleNo: article.articleNo, countryCode: null, title: article.title, summary: null,
      thumbnailUrl: article.thumbnailUrl, articleUrl: article.articleUrl, contentLanguage: "ko" as const })),
  }, "en");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Translation timeout")), TRANSLATION_WAIT_MS); });
  translation.catch(() => undefined);
  const page = await Promise.race([translation, timeout]).finally(() => clearTimeout(timer));
  return articles.map(article => ({ ...article, title: page.list.find(item => item.articleNo === article.articleNo)?.title ?? article.title }));
}

/** Returns null when the articles are unavailable (or not yet translated for English) so the static feature card stays. */
export async function fetchDispatchArticles(locale: Locale): Promise<DispatchArticle[] | null> {
  const apiKey = process.env.GUIDEME_MAGAZINE_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(`${DISPATCH_API_URL}?take=${DISPATCH_TAKE}`, {
      headers: { "X-GuideME-Api-Key": apiKey },
      next: { revalidate: DISPATCH_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) return null;
    const articles = parseDispatchArticles(await response.json());
    if (!articles.length) return null;
    return locale === "en" ? await englishTitles(articles) : articles;
  } catch {
    return null;
  }
}
