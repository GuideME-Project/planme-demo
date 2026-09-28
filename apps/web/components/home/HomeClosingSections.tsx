"use client";
import { homeMediaUrl } from "./home-media";

import Image from "next/image";
import { CalendarCheck2, ChevronDown, Luggage, Plane, Route } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { appLinks, questions } from "./home-content";
import styles from "./closing.module.css";

export function HomeClosingSections() {
  const { locale } = useLocale();
  const korean = locale === "ko";
  const steps = [
    {
      Icon: Route,
      title: "Trip Planning",
      text: korean
        ? "여행 기간 동안\n무엇을 할지 계획합니다."
        : "Choose your departure, destination, and trip length.",
    },
    {
      Icon: CalendarCheck2,
      title: "Trip Booking",
      text: korean
        ? "여행에 필요한\n호텔과 교통편 등을 예약합니다"
        : "Explore the services for your journey.",
    },
    {
      Icon: Luggage,
      title: "Trip Preparation",
      text: korean
        ? "모든 숙박 시설과\n여행 필수품을 준비합니다."
        : "Review your itinerary and get ready to go.",
    },
    {
      Icon: Plane,
      title: "Trip Experience",
      text: korean
        ? "롤러와 함께\n최고의 여행 경험을 제공합니다."
        : "Travel with local Rollers through GuideME.",
    },
  ];

  return (
    <>
      <div className={styles.processBackground}>
        <div className={styles.container}>
          <section id="how-it-works" className={styles.process} aria-labelledby="process-title">
            <div className={styles.processHeading}>
              <h2 id="process-title">PROCESS</h2>
              <p>HOW IT WORKS</p>
            </div>
            <div className={styles.steps}>
              <svg className={styles.stepPath} viewBox="0 0 1200 310" fill="none" preserveAspectRatio="none" aria-hidden="true">
                <path d="M90 115C250 305 330 295 460 150S680 -25 805 120S995 310 1120 190" />
              </svg>
              {steps.map(({ Icon, title, text }) => (
                <div className={styles.step} key={title}>
                  <span className={styles.stepIcon}><Icon size={74} strokeWidth={1.35} aria-hidden="true" /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.faq} aria-labelledby="faq-title">
            <div className={styles.faqList}>
              {questions.map((item, index) => (
                <details key={item.question} name="planme-faq" open={index === 0 ? true : undefined}>
                  <summary>
                    <span>{korean ? item.questionKo : item.question}</span>
                    <span className={styles.faqToggle}><ChevronDown size={21} strokeWidth={1.6} aria-hidden="true" /></span>
                  </summary>
                  <p>{korean ? item.answerKo : item.answer}</p>
                </details>
              ))}
            </div>
            <div className={styles.faqIntro}>
              <h2 id="faq-title">Frequently<br />Asked<br />Questions</h2>
              <p>What our clients usually asked about<br className={styles.desktopBreak} /> our services and tours.</p>
            </div>
          </section>
        </div>
      </div>

      <footer className={`${styles.container} ${styles.footer}`}>
        <section className={styles.newsletter} aria-labelledby="newsletter-title">
          <h2 id="newsletter-title">NEWS-<br />LETTER</h2>
          <p>{korean ? "뉴스레터를 구독하고 특별한 여행 특가 정보를 받아보세요. 지금 바로 가입하세요!" : "Travel stories and GuideME news, all in one place."}</p>
          <div className={styles.newsletterPreview}>
            <label className={styles.srOnly} htmlFor="newsletter-email">{korean ? "이메일 주소" : "Email address"}</label>
            <input id="newsletter-email" type="email" placeholder="Email address" disabled aria-describedby="newsletter-status" />
            <button type="button" disabled>Book Now</button>
            <small id="newsletter-status">{korean ? "뉴스레터 구독 기능을 준비하고 있습니다." : "Newsletter subscriptions are being prepared."}</small>
          </div>
        </section>

        <section id="guide-app" className={styles.appFooter} aria-labelledby="guide-app-title">
          <div className={styles.appBrand}>
            <Image unoptimized src={homeMediaUrl("guideme-logo-transparent.png")} alt="GuideME" width={394} height={126} />
          </div>
          <div className={styles.appContent}>
            <h2 id="guide-app-title"><span>Ready?</span>Get the app<br />Get the GuideME app<br />on iOS &amp; Android.</h2>
            <div className={styles.storeLinks}>
              <a href={appLinks.ios} target="_parent" rel="noopener noreferrer" aria-label={korean ? "App Store에서 GuideME 다운로드" : "Download GuideME on the App Store"}>
                <span className={`${styles.platformIcon} ${styles.appleIcon}`} aria-hidden="true"><svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="m11 6 10 18M19 6 8 25M5 20h19" /></svg></span>
                <Image unoptimized src={homeMediaUrl("guideme-ios-qr.svg")} alt={korean ? "GuideME App Store 다운로드 QR 코드" : "GuideME App Store download QR code"} width={120} height={120} />
                <span className={styles.storeLabel}>App Store</span>
              </a>
              <a href={appLinks.android} target="_parent" rel="noopener noreferrer" aria-label={korean ? "Google Play에서 GuideME 다운로드" : "Download GuideME on Google Play"}>
                <span className={`${styles.platformIcon} ${styles.playIcon}`} aria-hidden="true"><svg viewBox="0 0 28 30"><path d="M4 3 19 15 4 27Z" fill="#35c3db" /><path d="m4 3 19 12 5-3Z" fill="#53dd8f" /><path d="m4 27 15-12 5 3Z" fill="#ef4d64" /><path d="m19 15 5-3 4 3-4 3Z" fill="#ffd244" /></svg></span>
                <Image unoptimized src={homeMediaUrl("guideme-android-qr.svg")} alt={korean ? "GuideME Google Play 다운로드 QR 코드" : "GuideME Google Play download QR code"} width={120} height={120} />
                <span className={styles.storeLabel}>Google Play</span>
              </a>
            </div>
          </div>
          <div className={styles.appCopyright}>Copyright © {new Date().getFullYear()} GuideME. All rights reserved.</div>
        </section>
      </footer>
    </>
  );
}
