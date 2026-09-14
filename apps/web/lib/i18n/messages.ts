import en from "./en.json";
import ko from "./ko.json";
import type { Locale } from "./routing";

const dictionaries: Record<Locale, Record<string, string>> = { en, ko };
export function translate(locale: Locale, text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const translated = dictionaries[locale][normalized];
  if (translated !== undefined) return translated;
  if (locale === "ko") return text;
  if (/^\d+일차$/.test(normalized)) return `Day ${normalized.slice(0, -2)}`;
  if (/^\d+페이지$/.test(normalized)) return `Page ${normalized.slice(0, -3)}`;
  const stay = normalized.match(/^(\d+)박\s*(\d+)일$/);
  if (stay) return `${stay[1]} ${stay[1] === "1" ? "night" : "nights"} / ${stay[2]} days`;
  if (/^(약\s*)?[\d\s시간분초]+(\s*절약)?$/.test(normalized)) {
    return normalized.replace(/^약\s*/, "About ").replace(/시간/g, " hr ").replace(/분/g, " min ").replace(/초/g, " sec ").replace(/절약/g, "saved").replace(/\s+/g, " ").trim();
  }
  if (normalized.includes(" → ") && /^[약\d\s시간분초→]+$/.test(normalized)) return normalized.split(" → ").map(value => translate(locale, value)).join(" → ");
  const estimated = normalized.match(/^(.+) · 예상 도보 (\d+)개 구간은 지도선 없음$/);
  if (estimated) return `${translate(locale, estimated[1])} · ${estimated[2]} estimated walking segments are not drawn`;
  const event = normalized.match(/^(.+) (복귀 이동 시작|수하물 보관|복귀|출발|여행 일정)$/);
  if (event) {
    const labels: Record<string, string> = { "복귀 이동 시작": "Return to", "수하물 보관": "Store luggage at", "복귀": "Return to", "출발": "Depart from", "여행 일정": "Itinerary for" };
    return `${labels[event[2]]} ${event[1]}`;
  }
  const delivered = normalized.match(/^짐 (.+) 도착$/);
  if (delivered) return `Luggage delivered to ${delivered[1]}`;
  const saved = normalized.match(/^캐리미로 짐을 이동하니, 관광할 시간이 (.+) 더 많아졌어요$/);
  if (saved) return `Enjoy ${translate(locale, saved[1]).replace(/^About /, "about ")} more time to explore with CarryME.`;
  const journey = normalized.match(/^출발 (.+), 목적지 (.+)$/);
  if (journey) return `Departure ${journey[1]}, destination ${journey[2]}`;
  return text;
}

export function translateError(locale: Locale, message: string) {
  const translated = translate(locale, message);
  return locale === "en" && /[가-힣]/.test(translated)
    ? "We couldn't complete this request. Please try again."
    : translated;
}
