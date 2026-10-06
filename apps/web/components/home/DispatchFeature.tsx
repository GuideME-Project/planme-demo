"use client";
import { homeMediaUrl } from "./home-media";

import Image from "next/image";
import { ArrowRight, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import type { DispatchArticle } from "@/lib/planme-dispatch";
import homeStyles from "./home.module.css";
import rollerStyles from "./roller-cards.module.css";
import styles from "./dispatch-feature.module.css";

const rotationIntervalMs = 5000;

function formatDate(publishedAt: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" })
    .format(new Date(publishedAt));
}

/** The large TRAVEL card: Roller's Dispatch articles from guideme.co.kr rotate here; without them the static design card stays. */
export function DispatchFeature({ articles }: { articles?: DispatchArticle[] | null }) {
  const { locale } = useLocale();
  const korean = locale === "ko";
  const slideId = useId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = articles?.length ?? 0;

  useEffect(() => {
    if (count < 2 || paused || hovered || focused) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const syncRotation = () => {
      window.clearInterval(timer);
      if (!document.hidden && !motion.matches) {
        timer = window.setInterval(() => setIndex((current) => (current + 1) % count), rotationIntervalMs);
      }
    };
    syncRotation();
    document.addEventListener("visibilitychange", syncRotation);
    motion.addEventListener("change", syncRotation);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncRotation);
      motion.removeEventListener("change", syncRotation);
    };
  }, [count, paused, hovered, focused]);

  if (!articles?.length) {
    return (
      <a className={homeStyles.rollerFeature} href="#discover">
        <Image unoptimized src={homeMediaUrl("roller-landscape.jpg")} alt="" fill sizes="(max-width: 767px) 100vw, 1000px" />
        <div><span className={homeStyles.eyebrow}>TRAVEL</span><h2 id="rollers-title">The Ultimate<br />FOMO-Proof<br />Guide</h2><span className={homeStyles.featureArrow}><ArrowRight size={24} aria-label={korean ? "여행 콘텐츠 둘러보기" : "Explore travel stories"} /></span></div>
      </a>
    );
  }

  const current = articles[Math.min(index, articles.length - 1)];
  const reporter = current.reporterName ?? "GuideME";
  const pauseLabel = paused
    ? korean ? "Roller's Dispatch 기사 자동 전환 재개" : "Resume Roller's Dispatch stories"
    : korean ? "Roller's Dispatch 기사 자동 전환 일시정지" : "Pause Roller's Dispatch stories";

  return (
    <div
      className={`${homeStyles.rollerFeature} ${styles.feature}`}
      role="group"
      aria-roledescription={korean ? "캐러셀" : "carousel"}
      aria-labelledby="rollers-title"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span id={slideId} className={styles.photos} aria-hidden="true">
        {articles.map((article, photoIndex) => (
          <Image key={article.articleNo} className={photoIndex === index ? styles.visiblePhoto : styles.photo}
            src={article.thumbnailUrl} alt="" fill unoptimized loading="eager" sizes="(max-width: 767px) 100vw, 1000px" />
        ))}
      </span>
      <a className={styles.link} href={current.articleUrl} target="_blank" rel="noopener noreferrer">
        <span className={homeStyles.eyebrow}>TRAVEL</span>
        <h2 id="rollers-title" className={styles.title} aria-live="polite">{current.title}</h2>
        <span className={styles.footer}>
          <span className={styles.byline}>
            {/* Without a member photo, use guideme.co.kr's own default reporter image (img/no_member_2025.png, resized). */}
            <Image className={styles.avatar} src={current.reporterPhotoUrl ?? "/brand/reporter-default.jpg"} alt="" width={44} height={44} unoptimized />
            <span><strong>{reporter}</strong><time dateTime={current.publishedAt}>{formatDate(current.publishedAt, locale)}</time></span>
          </span>
          <span className={homeStyles.featureArrow}><ArrowRight size={24} aria-label={korean ? "기사 새 창에서 읽기" : "Read the story in a new tab"} /></span>
        </span>
      </a>
      {articles.length > 1 && (
        <div className={`${rollerStyles.controls} ${styles.controls}`}>
          <span className={rollerStyles.count} aria-label={korean ? `기사 ${articles.length}개 중 ${index + 1}번째` : `Story ${index + 1} of ${articles.length}`}>{index + 1} / {articles.length}</span>
          <button type="button" onClick={() => setPaused((value) => !value)} aria-label={pauseLabel} title={pauseLabel} aria-pressed={paused} aria-controls={slideId}>
            {paused ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => setIndex((value) => (value + 1) % articles.length)} aria-label={korean ? "다음 기사" : "Next story"} title={korean ? "다음 기사" : "Next story"} aria-controls={slideId}>
            <ChevronRight size={19} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
