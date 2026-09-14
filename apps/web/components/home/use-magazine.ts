"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { MAGAZINE_PAGE_SIZE, parseMagazinePage } from "@/lib/planme-magazine";
import { useMagazineCountry } from "./MagazineContext";
import type { HomeArticle } from "./home-content";

type Result = { key: string; skip: number; attempt: number; articles: HomeArticle[]; count: number; failed: boolean };

export function useMagazine() {
  const { countryCode } = useMagazineCountry();
  const { locale } = useLocale();
  const key = `${countryCode}:${locale}`;
  const [request, setRequest] = useState({ key, skip: 0, attempt: 0 });
  const skip = request.key === key ? request.skip : 0;
  const attempt = request.key === key ? request.attempt : 0;
  const [result, setResult] = useState<Result | null>(null);
  const current = result?.key === key ? result : null;
  const loading = Boolean(countryCode && (!current || current.skip !== skip || current.attempt !== attempt));

  useEffect(() => {
    if (!countryCode) return;
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ countryCode: countryCode!, language: locale, skip: String(skip) });
        const response = await fetch(`/api/magazine?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Magazine unavailable");
        const page = parseMagazinePage(await response.text(), countryCode!);
        if (controller.signal.aborted) return;
        const articles = page.list.map(article => ({
          id: String(article.articleNo), title: article.title, summary: article.summary ?? "",
          href: article.articleUrl, image: article.thumbnailUrl, language: article.contentLanguage,
        }));
        setResult(previous => {
          const combined = skip > 0 && previous?.key === key ? [...previous.articles, ...articles] : articles;
          return { key, skip, attempt, count: page.count, failed: false,
            articles: combined.filter((article, index) => combined.findIndex(item => item.id === article.id) === index) };
        });
      } catch {
        if (!controller.signal.aborted) setResult(previous => ({ key, skip, attempt, failed: true,
          count: previous?.key === key ? previous.count : 0,
          articles: previous?.key === key ? previous.articles : [] }));
      }
    }
    void load();
    return () => controller.abort();
  }, [countryCode, locale, key, skip, attempt]);

  return {
    countryCode,
    articles: current?.articles ?? [],
    loading,
    failed: !loading && Boolean(current?.failed),
    hasMore: Boolean(current && !current.failed && current.skip + MAGAZINE_PAGE_SIZE < current.count),
    retry: () => setRequest({ key, skip, attempt: attempt + 1 }),
    loadMore: () => setRequest({ key, skip: skip + MAGAZINE_PAGE_SIZE, attempt: 0 }),
  };
}
