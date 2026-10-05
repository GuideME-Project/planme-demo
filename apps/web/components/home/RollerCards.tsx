"use client";
import { homeMediaUrl } from "./home-media";

import Image from "next/image";
import { ChevronRight, Heart, Pause, Play } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { formatLikeCount, type PlanmeRoller, type PlanmeRollerCards } from "@/lib/planme-rollers";
import homeStyles from "./home.module.css";
import styles from "./roller-cards.module.css";

const rollers = [
  { name: "Star Roller", imagePrefix: "star-roller", group: "STAR" },
  { name: "Pro Roller", imagePrefix: "pro-roller", group: "PRO" },
] as const;

// Static design photos are shown when the GuideME roller API is unavailable.
const fallbackSlides = [1, 2, 3, 4] as const;
const rotationIntervalMs = 3000;

type Slide = { imageUrl: string; roller?: PlanmeRoller };

// Only phones can open the GuideME app; desktop visitors stay on PlanME and get the store QR codes.
function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function RollerCard({ name, imagePrefix, slides }: (typeof rollers)[number] & { slides: Slide[] }) {
  const { locale } = useLocale();
  const korean = locale === "ko";
  const slideId = useId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (paused || hovered || focused) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const syncRotation = () => {
      window.clearInterval(timer);
      if (!document.hidden && !motion.matches) {
        timer = window.setInterval(() => {
          setIndex((current) => (current + 1) % slides.length);
        }, rotationIntervalMs);
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
  }, [paused, hovered, focused, slides.length]);

  const current = slides[Math.min(index, slides.length - 1)];
  const pauseLabel = paused
    ? korean ? `${name} 사진 자동 전환 재개` : `Resume ${name} photos`
    : korean ? `${name} 사진 자동 전환 일시정지` : `Pause ${name} photos`;

  return (
    <div
      className={`${homeStyles.rollerGroup} ${styles.card}`}
      role="group"
      aria-label={korean ? `${name} 사진` : `${name} photos`}
      aria-roledescription={korean ? "캐러셀" : "carousel"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <a
        className={styles.photoLink}
        href={current.roller?.profileUrl ?? "#guide-app"}
        target={current.roller ? "_parent" : undefined}
        rel={current.roller ? "noopener noreferrer" : undefined}
        onClick={(event) => {
          if (!current.roller || isMobileDevice()) return;
          event.preventDefault();
          // Assigning an unchanged hash does not scroll again, so scroll to the download section on every click.
          document.getElementById("guide-app")?.scrollIntoView({ block: "start", behavior: "instant" });
          window.history.replaceState(null, "", "#guide-app");
        }}
        aria-label={current.roller
          ? korean ? `${current.roller.nickname} 프로필, GuideME 앱에서 보기` : `View ${current.roller.nickname}'s profile in the GuideME app`
          : korean ? `${name}, GuideME 앱에서 만나보세요` : `Meet ${name}s in the GuideME app`}
      >
        <span id={slideId} className={styles.photos} aria-hidden="true">
          {slides.map((slide, photoIndex) => (
            <Image
              key={slide.imageUrl}
              className={photoIndex === index ? styles.visiblePhoto : styles.photo}
              src={slide.imageUrl}
              alt=""
              fill
              loading="eager"
              unoptimized
              sizes="(max-width: 767px) 50vw, 470px"
            />
          ))}
        </span>
        <div><span className={styles.category}>{imagePrefix === "star-roller" ? "GUIDE" : "INSPIRATION"}</span><h3>{name}</h3>
          {current.roller && <span className={styles.likes}><Heart size={12} fill="currentColor" aria-hidden="true" />{formatLikeCount(current.roller.likeCount)}<span className={styles.srOnly}>{korean ? " 좋아요" : " likes"}</span></span>}
        </div>
        {current.roller && <div className={styles.profile} aria-live="polite"><strong>{current.roller.nation}</strong><span>{current.roller.nickname}</span></div>}
      </a>
      <div className={styles.controls}>
        <span className={styles.count} aria-label={korean ? `사진 ${slides.length}개 중 ${index + 1}번째` : `Photo ${index + 1} of ${slides.length}`}>{index + 1} / {slides.length}</span>
        <button type="button" onClick={() => setPaused((current) => !current)} aria-label={pauseLabel} title={pauseLabel} aria-pressed={paused} aria-controls={slideId}>
          {paused ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setIndex((current) => (current + 1) % slides.length)} aria-label={korean ? `${name} 다음 사진` : `Next ${name} photo`} title={korean ? "다음 사진" : "Next photo"} aria-controls={slideId}>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function RollerCards({ cards }: { cards?: PlanmeRollerCards | null }) {
  return <div className={homeStyles.rollerGroups}>{rollers.map((roller) => {
    const live = cards?.[roller.group];
    const slides: Slide[] = live?.length
      ? live.map((item) => ({ imageUrl: item.imageUrl, roller: item }))
      : fallbackSlides.map((number) => ({ imageUrl: homeMediaUrl(`${roller.imagePrefix}-${number}.jpg`) }));
    return <RollerCard key={roller.name} {...roller} slides={slides} />;
  })}</div>;
}
