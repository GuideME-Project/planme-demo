"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Grid2X2,
  List,
  MapPin,
  Pause,
  Plane,
  Play,
  Search,
  Smartphone,
  Sparkles,
} from "lucide-react";
import {
  appLinks,
  categories,
  partnerLinks,
  picks,
  questions,
  type ContentCategory,
  type HomeArticle,
} from "./home-content";
import styles from "./home.module.css";
import { getContentPage } from "./content-pagination";

type PlanmeHomeProps = { children: ReactNode; articles?: HomeArticle[] };

function PartnerLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className={className}
    >
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
      <span className={styles.srOnly}> (제휴 사이트, 새 탭)</span>
    </a>
  );
}

function StoreLinks() {
  return (
    <div className={styles.storeLinks}>
      <a href={appLinks.ios} target="_blank" rel="noopener noreferrer">
        <Smartphone size={22} aria-hidden="true" />
        <span>
          <small>iPhone · iPad</small>App Store
        </span>
        <ArrowUpRight size={17} aria-hidden="true" />
        <span className={styles.srOnly}>에서 다운로드 (새 탭)</span>
      </a>
      <a href={appLinks.android} target="_blank" rel="noopener noreferrer">
        <Play size={21} aria-hidden="true" />
        <span>
          <small>Android</small>Google Play
        </span>
        <ArrowUpRight size={17} aria-hidden="true" />
        <span className={styles.srOnly}>에서 다운로드 (새 탭)</span>
      </a>
    </div>
  );
}

const banners = [
  {
    name: "FlyME",
    text: "여행의 시작, 항공권부터",
    label: "항공권 검색하기",
    href: partnerLinks.flight,
  },
  {
    name: "RestME",
    text: "여행지에서의 편안한 쉼",
    label: "숙소 찾아보기",
    href: partnerLinks.stay,
  },
  {
    name: "PlayME",
    text: "오래 기억될 경험을 찾아",
    label: "투어·체험 둘러보기",
    href: partnerLinks.tour,
  },
];

function PartnerBanner() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || interacting) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !motion.matches)
        setIndex((value) => (value + 1) % banners.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, interacting]);
  const banner = banners[index];
  return (
    <div
      className={styles.partnerBanner}
      aria-roledescription="캐러셀"
      aria-label="여행 제휴 서비스"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setInteracting(false);
      }}
    >
      <span className={styles.eyebrow}>TRAVEL PARTNERS</span>
      <strong>{banner.name}</strong>
      <p>{banner.text}</p>
      <PartnerLink href={banner.href}>{banner.label}</PartnerLink>
      <div className={styles.carouselControls}>
        <span>{String(index + 1).padStart(2, "0")} / 03</span>
        <button
          aria-label="이전 제휴 서비스"
          onClick={() =>
            setIndex((index + banners.length - 1) % banners.length)
          }
        >
          <ChevronLeft size={17} />
        </button>
        <button
          aria-label="다음 제휴 서비스"
          onClick={() => setIndex((index + 1) % banners.length)}
        >
          <ChevronRight size={17} />
        </button>
        <button
          aria-label={
            paused ? "배너 자동 전환 재생" : "배너 자동 전환 일시정지"
          }
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
      </div>
    </div>
  );
}

function ContentExplorer({ articles }: { articles: HomeArticle[] }) {
  const [category, setCategory] = useState<ContentCategory>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const keyword = query.trim().toLocaleLowerCase();
  const visiblePicks = picks.filter(
    (pick) =>
      (category === "all" || pick.category === category) &&
      `${pick.title} ${pick.description} ${pick.keywords} ${pick.partner}`
        .toLocaleLowerCase()
        .includes(keyword),
  );
  const visibleArticles =
    category === "all" || category === "magazine"
      ? articles.filter((article) =>
          `${article.title} ${article.summary}`
            .toLocaleLowerCase()
            .includes(keyword),
        )
      : [];
  const total = visiblePicks.length + visibleArticles.length;
  const { pageCount, currentPage, offset, end, pageNumbers } = getContentPage(
    total,
    page,
  );
  const pagePicks = visiblePicks.slice(offset, end);
  const pageArticles = visibleArticles.slice(
    Math.max(0, offset - visiblePicks.length),
    Math.max(0, end - visiblePicks.length),
  );
  const changePage = (next: number) => {
    setPage(next);
    panelRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  };
  return (
    <section
      id="discover"
      className={styles.section}
      aria-labelledby="discover-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="discover-title">PlanME’s Pick</h2>
        </div>
        <label className={styles.contentSearch}>
          <Search size={19} aria-hidden="true" />
          <span className={styles.srOnly}>여행 콘텐츠 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search"
          />
        </label>
      </div>
      <div className={styles.explorerToolbar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="여행 콘텐츠 종류"
        >
          {categories.map((item, index) => (
            <button
              key={item.id}
              id={`home-tab-${item.id}`}
              role="tab"
              aria-selected={category === item.id}
              aria-controls="home-content-panel"
              tabIndex={category === item.id ? 0 : -1}
              onClick={() => {
                setCategory(item.id);
                setPage(1);
              }}
              onKeyDown={(event) => {
                const offset =
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (!offset && event.key !== "Home" && event.key !== "End")
                  return;
                event.preventDefault();
                const next =
                  categories[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? categories.length - 1
                        : (index + offset + categories.length) %
                          categories.length
                  ];
                setCategory(next.id);
                setPage(1);
                document.getElementById(`home-tab-${next.id}`)?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className={styles.viewToggle}
          aria-label="콘텐츠 보기 방식"
          role="group"
        >
          <button
            aria-label="격자 보기"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={18} />
            <span>Grid View</span>
          </button>
          <button
            aria-label="목록 보기"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={19} />
            <span>List View</span>
          </button>
        </div>
      </div>
      <p className={styles.contentNotice}>
        제휴사에서 상품과 예약 가능 여부를 확인해 주세요. 콘텐츠 검색은 위 여행
        일정 검색과 별도로 동작합니다.
      </p>
      <div
        ref={panelRef}
        id="home-content-panel"
        role="tabpanel"
        aria-labelledby={`home-tab-${category}`}
        tabIndex={0}
      >
        <span className={styles.srOnly} role="status">
          콘텐츠 {visiblePicks.length + visibleArticles.length}개
        </span>
        <div
          className={view === "grid" ? styles.pickGrid : styles.pickList}
          data-count={pagePicks.length + pageArticles.length}
          data-layout={
            pagePicks.length === 6 && !pageArticles.length
              ? "mosaic"
              : "balanced"
          }
        >
          {pagePicks.map((pick) => (
            <a
              key={pick.id}
              className={`${styles.pickCard} ${pick.category === "flight" ? styles.flightCard : ""}`}
              href={pick.href}
              target="_blank"
              rel="sponsored noopener noreferrer"
            >
              <Image
                src={pick.image}
                alt={pick.imageAlt}
                fill
                sizes={
                  pagePicks.length + pageArticles.length === 1
                    ? "100vw"
                    : "(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 66vw"
                }
              />
              <div className={styles.cardShade} />
              <span className={styles.partnerBadge}>
                {pick.category === "flight"
                  ? "FlyME"
                  : pick.category === "stay"
                    ? "RestME"
                    : "PlayME"}{" "}
                · {pick.partner}
              </span>
              {pick.category === "flight" && (
                <Plane
                  className={styles.flightIcon}
                  size={66}
                  aria-hidden="true"
                />
              )}
              <div className={styles.pickCopy}>
                <h3>{pick.title}</h3>
                <p>{pick.description}</p>
                <span>
                  Learn More <ArrowUpRight size={17} aria-hidden="true" />
                  <span className={styles.srOnly}> (새 탭)</span>
                </span>
              </div>
            </a>
          ))}
          {pageArticles.map((article) => (
            <a
              className={styles.articleCard}
              key={article.id}
              href={article.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={styles.eyebrow}>ROLLER’S DISPATCH</span>
              <h3>{article.title}</h3>
              <p>{article.summary}</p>
              <span>
                기사 읽기 <ArrowUpRight size={18} aria-hidden="true" />
                <span className={styles.srOnly}> (새 탭)</span>
              </span>
            </a>
          ))}
        </div>
        {!visiblePicks.length && !visibleArticles.length && (
          <div className={styles.emptyState}>
            <Compass size={32} aria-hidden="true" />
            <h3>
              {category === "magazine"
                ? "새로운 여행 이야기를 준비하고 있어요"
                : "검색한 콘텐츠가 없어요"}
            </h3>
            <p>
              {category === "magazine"
                ? "다른 여행 콘텐츠에서 다음 여행의 영감을 찾아보세요."
                : "다른 도시 이름이나 여행 스타일로 다시 찾아보세요."}
            </p>
            <button
              onClick={() => {
                setPage(1);
                setCategory("all");
                setQuery("");
              }}
            >
              전체 콘텐츠 보기 <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {total > 0 && (
        <nav className={styles.pagination} aria-label="콘텐츠 페이지">
          <button
            aria-label="이전 페이지"
            disabled={currentPage === 1}
            onClick={() => changePage(currentPage - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          {pageNumbers.map((number, index) => (
            <span key={number}>
              {index > 0 && number - pageNumbers[index - 1] > 1 && (
                <span className={styles.pageGap} aria-hidden="true">
                  …
                </span>
              )}
              <button
                aria-label={`${number}페이지`}
                aria-current={currentPage === number ? "page" : undefined}
                onClick={() => changePage(number)}
              >
                {String(number).padStart(2, "0")}
              </button>
            </span>
          ))}
          <button
            aria-label="다음 페이지"
            disabled={currentPage === pageCount}
            onClick={() => changePage(currentPage + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
      )}
    </section>
  );
}

export function PlanmeHome({ children, articles = [] }: PlanmeHomeProps) {
  return (
    <main className={styles.home}>
      <a className={styles.skipLink} href="#trip-search">
        여행 검색으로 바로가기
      </a>
      <div className={styles.hero}>
        <Image
          src="/brand/planme-search-background.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className={styles.heroBackground}
        />
        <header className={styles.header}>
          <Link href="/" aria-label="PlanME 홈">
            <Image
              src="/brand/planme-logo.png"
              alt="PlanME by GuideME"
              width={260}
              height={36}
              priority
            />
          </Link>
          <nav aria-label="홈 메뉴">
            <a href="#discover">여행 둘러보기</a>
            <a href="#how-it-works">이용 방법</a>
            <a className={styles.navApp} href="#app-download">
              GuideME 앱 <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </nav>
        </header>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>DISCOVER YOUR NEXT</span>
          <h1>
            For ME,
            <br />
            By Human Touch,
            <br />
            <span>With GuideME!</span>
          </h1>
          <p>
            Connecting Hearts Across Borders: A Journey for Every You in the
            World
          </p>
          <a href="#trip-search" className={styles.heroJump}>
            <ArrowDown size={17} aria-hidden="true" />
            <span className={styles.srOnly}>여행 검색으로 이동</span>
          </a>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.searchDock}>{children}</div>
        <section className={styles.tripIntro} aria-labelledby="trip-title">
          <div className={styles.tripIcon}>
            <CalendarDays size={26} aria-hidden="true" />
          </div>
          <div>
            <span className={styles.eyebrow}>YOUR TRIP, YOUR WAY</span>
            <h2 id="trip-title">여행의 시작은, 나만의 일정부터</h2>
            <p>
              목적지와 여행 기간을 알려주세요. 추천 장소부터 이동 경로까지 함께
              준비할게요.
            </p>
          </div>
          <a href="#trip-search">
            일정 만들기 <ArrowUpRight size={19} aria-hidden="true" />
          </a>
        </section>
        <section
          className={styles.mediaSection}
          aria-label="GuideME 소개와 여행 서비스"
        >
          <div className={styles.mainVideo}>
            <video
              controls
              playsInline
              preload="none"
              poster="/home/guideme-poster.jpg"
              aria-label="GuideME 소개 영상"
              src="/home/roller-introduction.mp4"
            >
              브라우저가 영상 재생을 지원하지 않습니다.{" "}
              <a href="/home/roller-introduction.mp4">소개 영상 열기</a>
            </video>
            <div>
              <span className={styles.eyebrow}>MEET GUIDEME</span>
              <h2>
                여행지에서 만나는
                <br />
                새로운 연결
              </h2>
              <p>당신의 여행에 사람의 온기를 더합니다.</p>
            </div>
          </div>
          <div className={styles.mediaAside}>
            <div className={styles.smallVideo}>
              <video
                controls
                playsInline
                preload="none"
                poster="/home/roller-poster.jpg"
                src="/home/roller-introduction-2.mp4"
                aria-label="롤러 소개 영상"
              >
                브라우저가 영상 재생을 지원하지 않습니다.{" "}
                <a href="/home/roller-introduction-2.mp4">
                  롤러 소개 영상 열기
                </a>
              </video>
              <span>
                Watch Our
                <br />
                Profile Video
              </span>
            </div>
            <PartnerBanner />
          </div>
        </section>
        <ContentExplorer articles={articles} />
        <section className={styles.staySection} aria-labelledby="stay-title">
          <div>
            <span className={styles.eyebrow}>RestME</span>
            <h2 id="stay-title">Only The Best Quality For You</h2>
            <p>
              Find your next stay with RestME. Check availability and booking
              conditions with our partner.
            </p>
            <PartnerLink className={styles.blueButton} href={partnerLinks.stay}>
              Learn More
            </PartnerLink>
          </div>
          <div className={styles.stayImage}>
            <Image
              src="/home/rest-me-popular-hotel-1.png"
              alt="초록 식물과 수영장이 있는 숙소의 휴식 공간"
              fill
              sizes="(max-width: 767px) 100vw, 50vw"
            />
          </div>
          <div className={styles.stayNotes}>
            <span>
              <Check size={20} />
              나에게 맞는 숙소 탐색
            </span>
            <span>
              <Check size={20} />
              제휴사에서 예약 조건 확인
            </span>
            <span>
              <Check size={20} />
              나만의 여행에 쉼 더하기
            </span>
          </div>
        </section>
        <section
          className={styles.flightSection}
          aria-labelledby="flight-title"
        >
          <div>
            <span className={styles.eyebrow}>BOOK YOUR DREAM VACATION</span>
            <h2 id="flight-title">TODAY</h2>
            <p>Find flights for your next journey with Aviasales.</p>
            <PartnerLink
              className={styles.blueButton}
              href={partnerLinks.flight}
            >
              Book Now
            </PartnerLink>
          </div>
          <Plane size={126} strokeWidth={1} aria-hidden="true" />
        </section>
        {!!articles.length && (
          <section className={styles.section} aria-labelledby="magazine-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>ROLLER’S DISPATCH</span>
                <h2 id="magazine-title">여행을 읽는 시간</h2>
              </div>
            </div>
            <div className={styles.articleGrid}>
              {articles.slice(0, 3).map((article) => (
                <a
                  key={article.id}
                  href={article.href}
                  className={styles.articleCard}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <h3>{article.title}</h3>
                  <p>{article.summary}</p>
                  <span>
                    기사 읽기 <ArrowUpRight size={18} aria-hidden="true" />
                    <span className={styles.srOnly}> (새 탭)</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
        <section
          id="app-download"
          className={styles.appCta}
          aria-labelledby="app-title"
        >
          <h2 id="app-title">READY TO EXPLORE THE WORLD?</h2>
          <p>Meet local Rollers and discover new experiences with GuideME.</p>
          <StoreLinks />
        </section>
      </div>
      <div className={styles.processBackground}>
        <div className={styles.container}>
          <section
            id="how-it-works"
            className={styles.process}
            aria-labelledby="process-title"
          >
            <span className={styles.eyebrow}>HOW IT WORKS</span>
            <h2 id="process-title">PROCESS</h2>
            <div className={styles.steps}>
              {[
                {
                  icon: MapPin,
                  title: "Trip Planning",
                  text: "Choose your departure, destination, and travel dates.",
                },
                {
                  icon: CalendarDays,
                  title: "Trip Booking",
                  text: "Explore flights, stays, and activities on our partner sites.",
                },
                {
                  icon: Compass,
                  title: "Trip Preparation",
                  text: "Review your itinerary and prepare for your trip.",
                },
                {
                  icon: Sparkles,
                  title: "Trip Experience",
                  text: "Meet local Rollers through GuideME.",
                },
              ].map((step, index) => (
                <div className={styles.step} key={step.title}>
                  <span className={styles.stepIcon}>
                    <step.icon size={29} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <small>0{index + 1}</small>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              ))}
            </div>
          </section>
          <section className={styles.faq} aria-labelledby="faq-title">
            <div>
              <h2 id="faq-title">Frequently Asked Questions</h2>
              <p>
                What our clients usually asked about our services and tours.
              </p>
            </div>
            <div className={styles.faqList}>
              {questions.map((item, index) => (
                <details
                  key={item.question}
                  open={index === 0 ? true : undefined}
                >
                  <summary>
                    {item.question}
                    <ChevronDown size={20} aria-hidden="true" />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
      <footer className={`${styles.container} ${styles.footer}`}>
        <div className={styles.footerIntro}>
          <Image
            src="/brand/planme-logo.png"
            alt="PlanME by GuideME"
            width={250}
            height={35}
          />
          <p>
            여행을 계획하는 순간부터
            <br />
            새로운 사람을 만나는 순간까지.
          </p>
          <a href="#trip-search">
            나만의 여행 시작하기 <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
        <div className={styles.appFooter}>
          <span className={styles.eyebrow}>Ready?</span>
          <h2>
            Get the app
            <br />
            Get the GuideME app
            <br />
            on iOS &amp; Android.
          </h2>
          <StoreLinks />
          <p>© {new Date().getFullYear()} GuideME</p>
        </div>
      </footer>
    </main>
  );
}
