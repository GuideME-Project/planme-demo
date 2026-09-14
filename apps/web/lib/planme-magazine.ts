export type MagazineArticle = {
  articleNo: number;
  countryCode: string;
  title: string;
  summary: string | null;
  thumbnailUrl: string | null;
  articleUrl: string;
  contentLanguage: "ko" | "en" | "ja" | "zh";
};

export type MagazinePage = { count: number; list: MagazineArticle[] };

// GuideME API origin/main 17ccee15: public magazine controller and response DTO.
export const MAGAZINE_API_URL = "https://api.guidemetrip.co.kr/api/v1/service/magazine/articles";
export const MAGAZINE_PAGE_SIZE = 6;

export class MagazineHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Magazine HTTP ${status}`);
    this.status = status;
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function parseMagazinePage(text: string, countryCode: string): MagazinePage {
  const response = JSON.parse(text) as { success?: boolean; data?: MagazinePage } | null;
  const page = response?.data;
  if (response?.success !== true || !page || !Number.isSafeInteger(page.count) || page.count < 0 ||
    !Array.isArray(page.list) || page.list.length > MAGAZINE_PAGE_SIZE || page.list.length > page.count ||
    !page.list.every(article => article && Number.isSafeInteger(article.articleNo) && article.articleNo > 0 &&
      article.countryCode === countryCode && typeof article.title === "string" && article.title.trim() &&
      (article.summary === null || typeof article.summary === "string") &&
      (article.thumbnailUrl === null || (typeof article.thumbnailUrl === "string" && isHttpUrl(article.thumbnailUrl))) &&
      (article.articleUrl === `https://guidemetrip.co.kr/post/detail/${article.articleNo}` ||
       article.articleUrl === `https://guideme.co.kr/detail.php?number=${article.articleNo}`) &&
      ["ko", "en", "ja", "zh"].includes(article.contentLanguage))) {
    throw new Error("Invalid magazine response");
  }
  return page;
}
