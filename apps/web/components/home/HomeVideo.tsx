"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { homeMediaUrl } from "./home-media";
import styles from "./home-video.module.css";

export function HomeVideo({ poster, source, label, profile = false }: {
  poster: string;
  source: string;
  label: string;
  profile?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  const play = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.controls = true;
    try {
      await video.play();
      setStarted(true);
      setFailed(false);
    } catch {
      video.controls = false;
      setFailed(true);
    }
  };

  return <div className={`${styles.video} ${profile ? styles.profile : ""}`}>
    <video ref={videoRef} controls={started} playsInline preload="none"
      poster={homeMediaUrl(poster)} src={homeMediaUrl(source)} aria-label={label}
      onPlay={() => setStarted(true)} onEnded={() => setStarted(false)} />
    {!started && <button type="button" className={styles.cover} onClick={play} aria-label={label}>
      {profile && <span className={styles.caption}>Watch Our<strong>Profile Video</strong></span>}
      <span className={styles.play}><Play fill="currentColor" strokeWidth={0} aria-hidden="true" /></span>
    </button>}
    {failed && <a className={styles.fallback} href={homeMediaUrl(source)}>{label} ↗</a>}
  </div>;
}
