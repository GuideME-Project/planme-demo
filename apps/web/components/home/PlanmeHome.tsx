"use client";
import { useLocale } from "@/components/i18n/LocaleProvider";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { useMagazine } from "./use-magazine";

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
  const { t } = useLocale();
  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      className={className}
    >
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
      <span className={styles.srOnly}>{t("(제휴 사이트, 새 탭)")}</span>
    </a>
  );
}

function StoreLinks() {
  const { t } = useLocale();
  return (
    <div className={styles.storeLinks}>
      <a href={appLinks.ios} target="_blank" rel="noopener noreferrer">
        <Smartphone size={22} aria-hidden="true" />
        <span>
          <small>iPhone · iPad</small>App Store
        </span>
        <ArrowUpRight size={17} aria-hidden="true" />
        <span className={styles.srOnly}>{t("에서 다운로드 (새 탭)")}</span>
      </a>
      <a href={appLinks.android} target="_blank" rel="noopener noreferrer">
        <Play size={21} aria-hidden="true" />
        <span>
          <small>Android</small>Google Play
        </span>
        <ArrowUpRight size={17} aria-hidden="true" />
        <span className={styles.srOnly}>{t("에서 다운로드 (새 탭)")}</span>
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
  const { t } = useLocale();
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
      aria-roledescription={t("캐러셀")}
      aria-label={t("여행 제휴 서비스")}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setInteracting(false);
      }}
    >
      <span className={styles.eyebrow}>{t("TRAVEL PARTNERS")}</span>
      <strong>{banner.name}</strong>
      <p>{t(banner.text)}</p>
      <PartnerLink href={banner.href}>{t(banner.label)}</PartnerLink>
      <div className={styles.carouselControls}>
        <span>{String(index + 1).padStart(2, "0")} / 03</span>
        <button
          aria-label={t("이전 제휴 서비스")}
          onClick={() =>
            setIndex((index + banners.length - 1) % banners.length)
          }
        >
          <ChevronLeft size={17} />
        </button>
        <button
          aria-label={t("다음 제휴 서비스")}
          onClick={() => setIndex((index + 1) % banners.length)}
        >
          <ChevronRight size={17} />
        </button>
        <button
          aria-label={
            paused ? t("배너 자동 전환 재생") : t("배너 자동 전환 일시정지")
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

type ContentSearch = { category: ContentCategory; query: string; view: "grid" | "list"; page: number };
function readContentSearch(text: string | null): ContentSearch {
  const empty: ContentSearch = { category: "all", query: "", view: "grid", page: 1 };
  try {
    const saved = JSON.parse(text ?? "null") as Partial<ContentSearch> | null;
    if (!saved || !categories.some(item => item.id === saved.category) || typeof saved.query !== "string" ||
      (saved.view !== "grid" && saved.view !== "list") || !Number.isInteger(saved.page) || saved.page! < 1) return empty;
    return saved as ContentSearch;
  } catch { return empty; }
}
function subscribeContentSearch(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function contentSearchSnapshot() {
  try { return sessionStorage.getItem("planme-content-search"); } catch { return null; }
}
type MagazineState = ReturnType<typeof useMagazine>;
function SavedContentExplorer({ articles, magazine }: { articles: HomeArticle[]; magazine: MagazineState }) {
  const saved = useSyncExternalStore(subscribeContentSearch, contentSearchSnapshot, () => null);
  return <ContentExplorer key={saved ?? "initial"} articles={articles} magazine={magazine} initial={readContentSearch(saved)} />;
}
function ArticleImage({ article }: { article: HomeArticle }) {
  const [failed, setFailed] = useState(false);
  return article.image && !failed ? (
    // Use the API's absolute media URL without introducing an image optimization cache.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.articleImage} src={article.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  ) : <div className={styles.articleImageFallback} aria-hidden="true"><Compass size={40} /></div>;
}

function MagazineNotice({ magazine }: { magazine: MagazineState }) {
  const { t, locale } = useLocale();
  const name = magazine.countryCode
    ? new Intl.DisplayNames([locale], { type: "region" }).of(magazine.countryCode) : null;
  return <div className={styles.magazineNotice} aria-busy={magazine.loading}>
    {name && <strong>{name} · {t("Roller’s Dispatch")}</strong>}
    <p role={magazine.failed ? "alert" : "status"}>
      {!magazine.countryCode ? t("여행지를 검색하면 해당 국가의 매거진 기사를 보여드려요.")
        : magazine.loading ? t("매거진 기사를 불러오고 있어요.")
        : magazine.failed ? t("매거진 기사를 불러오지 못했어요. 다시 시도해 주세요.")
        : !magazine.articles.length ? t("이 국가에 등록된 매거진 기사가 아직 없어요.")
        : t("검색한 국가의 여행 이야기를 만나보세요.")}
    </p>
    {magazine.failed && <button type="button" onClick={magazine.retry}>{t("다시 시도")}</button>}
    {magazine.hasMore && <button type="button" disabled={magazine.loading} onClick={magazine.loadMore}>{t("기사 더 보기")}</button>}
  </div>;
}

function ContentExplorer({ articles, initial, magazine }: { articles: HomeArticle[]; initial: ContentSearch; magazine: MagazineState }) {
  const { t, locale } = useLocale();
  const [category, setCategory] = useState<ContentCategory>(initial.category);
  const [query, setQuery] = useState(initial.query);
  const [view, setView] = useState<"grid" | "list">(initial.view);
  const [page, setPage] = useState(initial.page);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const save = (event: Event) => {
      try { sessionStorage.setItem("planme-content-search", JSON.stringify({ category, query, view, page })); }
      catch { event.preventDefault(); }
    };
    window.addEventListener("planme:before-language-change", save);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("planme:before-language-change", save);
      window.removeEventListener("pagehide", save);
    };
  }, [category, query, view, page]);
  const keyword = query.trim().toLocaleLowerCase();
  const visiblePicks = picks.filter(
    (pick) =>
      (category === "all" || pick.category === category) &&
      `${t(pick.title)} ${t(pick.description)} ${pick.keywords} ${pick.partner}`
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
          <h2 id="discover-title">{t("PlanME’s Pick")}</h2>
        </div>
        <label className={styles.contentSearch}>
          <Search size={19} aria-hidden="true" />
          <span className={styles.srOnly}>{t("여행 콘텐츠 검색")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={t("Search")}
          />
        </label>
      </div>
      <div className={styles.explorerToolbar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={t("여행 콘텐츠 종류")}
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
              {t(item.label)}
            </button>
          ))}
        </div>
        <div
          className={styles.viewToggle}
          aria-label={t("콘텐츠 보기 방식")}
          role="group"
        >
          <button
            aria-label={t("격자 보기")}
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={18} />
            <span>{t("Grid View")}</span>
          </button>
          <button
            aria-label={t("목록 보기")}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={19} />
            <span>{t("List View")}</span>
          </button>
        </div>
      </div>
      <p className={styles.contentNotice}>{t("제휴사에서 상품과 예약 가능 여부를 확인해 주세요. 콘텐츠 검색은 위 여행 일정 검색과 별도로 동작합니다.")}</p>
      {(category === "all" || category === "magazine") && <MagazineNotice magazine={magazine} />}
      <div
        ref={panelRef}
        id="home-content-panel"
        role="tabpanel"
        aria-labelledby={`home-tab-${category}`}
        tabIndex={0}
      >
        <span className={styles.srOnly} role="status">{locale === "ko" ? `콘텐츠 ${total}개` : `${total} ${total === 1 ? "item" : "items"}`}</span>
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
                alt={t(pick.imageAlt)}
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
                <h3>{t(pick.title)}</h3>
                <p>{t(pick.description)}</p>
                <span>{t("Learn More")}<ArrowUpRight size={17} aria-hidden="true" />
                  <span className={styles.srOnly}>{t("(새 탭)")}</span>
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
              <ArticleImage article={article} />
              <span className={styles.eyebrow}>{t("ROLLER’S DISPATCH")}</span>
              <h3 lang={article.language}>{article.title}</h3>
              <p lang={article.language}>{article.summary}</p>
              <span>{t("기사 읽기")}<ArrowUpRight size={18} aria-hidden="true" />
                <span className={styles.srOnly}>{t("(새 탭)")}</span>
              </span>
            </a>
          ))}
        </div>
        {!visiblePicks.length && !visibleArticles.length && (category !== "magazine" || (!magazine.loading && !magazine.failed && !!magazine.countryCode && articles.length > 0)) && (
          <div className={styles.emptyState}>
            <Compass size={32} aria-hidden="true" />
            <h3>
              {t("검색한 콘텐츠가 없어요")}
            </h3>
            <p>
              {t("다른 도시 이름이나 여행 스타일로 다시 찾아보세요.")}
            </p>
            <button
              onClick={() => {
                setPage(1);
                setCategory("all");
                setQuery("");
              }}
            >{t("전체 콘텐츠 보기")}<ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {total > 0 && (
        <nav className={styles.pagination} aria-label={t("콘텐츠 페이지")}>
          <button
            aria-label={t("이전 페이지")}
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
                aria-label={t(`${number}페이지`)}
                aria-current={currentPage === number ? "page" : undefined}
                onClick={() => changePage(number)}
              >
                {String(number).padStart(2, "0")}
              </button>
            </span>
          ))}
          <button
            aria-label={t("다음 페이지")}
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

export function PlanmeHome({ children, articles: initialArticles = [] }: PlanmeHomeProps) {
  const { t, locale } = useLocale();
  const magazine = useMagazine();
  const articles = magazine.countryCode ? magazine.articles : initialArticles;
  return (
    <main className={styles.home}>
      <a className={styles.skipLink} href="#trip-search">{t("여행 검색으로 바로가기")}</a>
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
          <Link href={`/${locale}`} aria-label={t("PlanME 홈")}>
            <Image
              src="/brand/planme-logo.png"
              alt="PlanME by GuideME"
              width={260}
              height={36}
              priority
            />
          </Link>
          <nav aria-label={t("홈 메뉴")}>
            <a href="#discover">{t("여행 둘러보기")}</a>
            <a href="#how-it-works">{t("이용 방법")}</a>
            <a className={styles.navApp} href="#app-download">{t("GuideME 앱")}<ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </nav>
          <LanguageSwitcher />
        </header>
        <div className={styles.heroCopy} lang="en">
          <span className={styles.eyebrow}>DISCOVER YOUR NEXT</span>
          <h1>For ME,{" "}<br />By Human Touch,<br />
            <span>With GuideME!</span>
          </h1>
          <p>Connecting Hearts Across Borders: A Journey for Every You in the World</p>
          <a href="#trip-search" className={styles.heroJump}>
            <ArrowDown size={17} aria-hidden="true" />
            <span className={styles.srOnly}>{t("여행 검색으로 이동")}</span>
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
            <span className={styles.eyebrow}>{t("YOUR TRIP, YOUR WAY")}</span>
            <h2 id="trip-title">{t("여행의 시작은, 나만의 일정부터")}</h2>
            <p>{t("목적지와 여행 기간을 알려주세요. 추천 장소부터 이동 경로까지 함께 준비할게요.")}</p>
          </div>
          <a href="#trip-search">{t("일정 만들기")}<ArrowUpRight size={19} aria-hidden="true" />
          </a>
        </section>
        <section
          className={styles.mediaSection}
          aria-label={t("GuideME 소개와 여행 서비스")}
        >
          <div className={styles.mainVideo}>
            <video
              controls
              playsInline
              preload="none"
              poster="/home/guideme-poster.jpg"
              aria-label={t("GuideME 소개 영상")}
              src="/home/roller-introduction.mp4"
            >{t("브라우저가 영상 재생을 지원하지 않습니다.")}{" "}
              <a href="/home/roller-introduction.mp4">{t("소개 영상 열기")}</a>
            </video>
            <div>
              <span className={styles.eyebrow}>{t("MEET GUIDEME")}</span>
              <h2>{t("여행지에서 만나는")}{" "}<br />{t("새로운 연결")}</h2>
              <p>{t("당신의 여행에 사람의 온기를 더합니다.")}</p>
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
                aria-label={t("롤러 소개 영상")}
              >{t("브라우저가 영상 재생을 지원하지 않습니다.")}{" "}
                <a href="/home/roller-introduction-2.mp4">{t("롤러 소개 영상 열기")}</a>
              </video>
              <span>{t("Watch Our")}{" "}<br />{t("Profile Video")}</span>
            </div>
            <PartnerBanner />
          </div>
        </section>
        {locale === "en" && articles.some(article => article.language !== "en") && <p>{t("원문 콘텐츠 안내")}</p>}
        <SavedContentExplorer articles={articles} magazine={magazine} />
        <section className={styles.staySection} aria-labelledby="stay-title">
          <div>
            <span className={styles.eyebrow}>RestME</span>
            <h2 id="stay-title">{t("Only The Best Quality For You")}</h2>
            <p>{t("Find your next stay with RestME. Check availability and booking conditions with our partner.")}</p>
            <PartnerLink className={styles.blueButton} href={partnerLinks.stay}>{t("Learn More")}</PartnerLink>
          </div>
          <div className={styles.stayImage}>
            <Image
              src="/home/rest-me-popular-hotel-1.png"
              alt={t("초록 식물과 수영장이 있는 숙소의 휴식 공간")}
              fill
              sizes="(max-width: 767px) 100vw, 50vw"
            />
          </div>
          <div className={styles.stayNotes}>
            <span>
              <Check size={20} />{t("나에게 맞는 숙소 탐색")}</span>
            <span>
              <Check size={20} />{t("제휴사에서 예약 조건 확인")}</span>
            <span>
              <Check size={20} />{t("나만의 여행에 쉼 더하기")}</span>
          </div>
        </section>
        <section
          className={styles.flightSection}
          aria-labelledby="flight-title"
        >
          <div>
            <span className={styles.eyebrow}>{t("BOOK YOUR DREAM VACATION")}</span>
            <h2 id="flight-title">{t("TODAY")}</h2>
            <p>{t("Find flights for your next journey with Aviasales.")}</p>
            <PartnerLink
              className={styles.blueButton}
              href={partnerLinks.flight}
            >{t("Book Now")}</PartnerLink>
          </div>
          <Plane size={126} strokeWidth={1} aria-hidden="true" />
        </section>
        {!!articles.length && (
          <section className={styles.section} aria-labelledby="magazine-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>{t("ROLLER’S DISPATCH")}</span>
                <h2 id="magazine-title">{t("여행을 읽는 시간")}</h2>
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
                  <ArticleImage article={article} />
                  <h3 lang={article.language}>{article.title}</h3>
                  <p lang={article.language}>{article.summary}</p>
                  <span>{t("기사 읽기")}<ArrowUpRight size={18} aria-hidden="true" />
                    <span className={styles.srOnly}>{t("(새 탭)")}</span>
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
          <h2 id="app-title">{t("READY TO EXPLORE THE WORLD?")}</h2>
          <p>{t("Meet local Rollers and discover new experiences with GuideME.")}</p>
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
            <span className={styles.eyebrow}>{t("HOW IT WORKS")}</span>
            <h2 id="process-title">{t("PROCESS")}</h2>
            <div className={styles.steps}>
              {[
                {
                  icon: MapPin,
                  title: t("Trip Planning"),
                  text: t("Choose your departure, destination, and travel dates."),
                },
                {
                  icon: CalendarDays,
                  title: t("Trip Booking"),
                  text: t("Explore flights, stays, and activities on our partner sites."),
                },
                {
                  icon: Compass,
                  title: t("Trip Preparation"),
                  text: t("Review your itinerary and prepare for your trip."),
                },
                {
                  icon: Sparkles,
                  title: t("Trip Experience"),
                  text: t("Meet local Rollers through GuideME."),
                },
              ].map((step, index) => (
                <div className={styles.step} key={t(step.title)}>
                  <span className={styles.stepIcon}>
                    <step.icon size={29} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <small>0{index + 1}</small>
                  <h3>{t(step.title)}</h3>
                  <p>{t(step.text)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className={styles.faq} aria-labelledby="faq-title">
            <div>
              <h2 id="faq-title">{t("Frequently Asked Questions")}</h2>
              <p>{t("What our clients usually asked about our services and tours.")}</p>
            </div>
            <div className={styles.faqList}>
              {questions.map((item, index) => (
                <details
                  key={t(item.question)}
                  open={index === 0 ? true : undefined}
                >
                  <summary>
                    {t(item.question)}
                    <ChevronDown size={20} aria-hidden="true" />
                  </summary>
                  <p>{t(item.answer)}</p>
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
          <p>{t("여행을 계획하는 순간부터")}{" "}<br />{t("새로운 사람을 만나는 순간까지.")}</p>
          <a href="#trip-search">{t("나만의 여행 시작하기")}<ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
        <div className={styles.appFooter}>
          <span className={styles.eyebrow}>{t("Ready?")}</span>
          <h2>{t("Get the app")}{" "}<br />{t("Get the GuideME app")}{" "}<br />{t("on iOS & Android.")}</h2>
          <StoreLinks />
          <p>© {new Date().getFullYear()} GuideME</p>
        </div>
      </footer>
    </main>
  );
}
