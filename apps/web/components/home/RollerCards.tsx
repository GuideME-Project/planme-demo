"use client";
import { homeMediaUrl } from "./home-media";

import Image from "next/image";
import { ArrowUpRight, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import homeStyles from "./home.module.css";
import styles from "./roller-cards.module.css";

const rollers = [
  { name: "Star Roller", imagePrefix: "star-roller" },
  { name: "Pro Roller", imagePrefix: "pro-roller" },
] as const;

const slideNumbers = [1, 2, 3, 4] as const;
const rotationIntervalMs = 3000;

function RollerCard({ name, imagePrefix }: (typeof rollers)[number]) {
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
          setIndex((current) => (current + 1) % slideNumbers.length);
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
  }, [paused, hovered, focused]);

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
      <a className={styles.photoLink} href="#guide-app" aria-label={korean ? `${name}, GuideME 앱에서 만나보세요` : `Meet ${name}s in the GuideME app`}>
        <span id={slideId} className={styles.photos} aria-hidden="true">
          {slideNumbers.map((number, photoIndex) => (
            <Image
              key={number}
              className={photoIndex === index ? styles.visiblePhoto : styles.photo}
              src={homeMediaUrl(`${imagePrefix}-${number}.jpg`)}
              alt=""
              fill
              loading="eager"
              unoptimized
              sizes="(max-width: 767px) 50vw, 470px"
            />
          ))}
        </span>
        <h3>{name}</h3>
        <span className={styles.caption}>{korean ? "GuideME 앱에서 만나보세요" : "Meet Rollers in the GuideME app"}<ArrowUpRight size={16} aria-hidden="true" /></span>
      </a>
      <div className={styles.controls}>
        <span className={styles.count} aria-label={korean ? `사진 ${slideNumbers.length}개 중 ${index + 1}번째` : `Photo ${index + 1} of ${slideNumbers.length}`}>{index + 1} / {slideNumbers.length}</span>
        <button type="button" onClick={() => setPaused((current) => !current)} aria-label={pauseLabel} title={pauseLabel} aria-pressed={paused} aria-controls={slideId}>
          {paused ? <Play size={14} fill="currentColor" aria-hidden="true" /> : <Pause size={14} fill="currentColor" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setIndex((current) => (current + 1) % slideNumbers.length)} aria-label={korean ? `${name} 다음 사진` : `Next ${name} photo`} title={korean ? "다음 사진" : "Next photo"} aria-controls={slideId}>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function RollerCards() {
  return <div className={homeStyles.rollerGroups}>{rollers.map((roller) => <RollerCard key={roller.name} {...roller} />)}</div>;
}
