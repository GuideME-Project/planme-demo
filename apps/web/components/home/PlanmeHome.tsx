"use client";
import { homeMediaUrl } from "./home-media";
import { useLocale } from "@/components/i18n/LocaleProvider";

import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  Compass,
  Grid2X2,
  List,
  Pause,
  Plane,
  Play,
  Search,
} from "lucide-react";
import {
  categories,
  partnerLinks,
  picks,
  type ContentCategory,
  type HomeArticle,
} from "./home-content";
import styles from "./home.module.css";
import { HomeClosingSections } from "./HomeClosingSections";
import { RollerCards } from "./RollerCards";
import { PartnerWidget } from "./PartnerWidget";
import { getContentPage } from "./content-pagination";
import { useMagazine } from "./use-magazine";

type PlanmeHomeProps = { children: ReactNode; articles?: HomeArticle[] };

const banners = [
  {
    name: "Meet the Rollers",
    nameKo: "롤러를 만나보세요",
    text: "Discover people who make every journey more personal.",
    textKo: "여행에 사람의 온기를 더하는 롤러를 만나보세요.",
    href: "#rollers",
    artwork: "banner-rollers",
  },
  {
    name: "Unbeatable Roller Perks",
    nameKo: "롤러만의 특별한 혜택",
    text: "Explore places through a local perspective.",
    textKo: "현지의 시선으로 새로운 장소를 살펴보세요.",
    href: "#discover",
    artwork: "banner-perks",
  },
  {
    name: "What are you waiting for?",
    nameKo: "무엇을 기다리고 계신가요?",
    text: "Start with a place you want to visit.",
    textKo: "가고 싶은 장소에서 여행을 시작하세요.",
    href: "#trip-search",
    artwork: "banner-waiting",
  },
  {
    name: "Apply Right Now!",
    nameKo: "지금 바로 함께하세요!",
    text: "Meet GuideME and the Roller community.",
    textKo: "GuideME와 롤러 커뮤니티를 만나보세요.",
    href: "#rollers",
    artwork: "banner-apply",
  },
  {
    name: "Get the Free App",
    nameKo: "무료 앱 다운로드",
    text: "Take GuideME with you wherever you go.",
    textKo: "어디서든 GuideME와 함께하세요.",
    href: "#app-download",
    artwork: "banner-download",
  },
];

function BannerArtwork({ name, paused = false }: { name: string; paused?: boolean }) {
  return <picture className={styles.bannerArtwork}>
    <source media="(prefers-reduced-motion: reduce)" srcSet={homeMediaUrl(`${name}.png`)} />
    <Image unoptimized src={homeMediaUrl(`${name}.${paused ? "png" : "gif"}`)} alt="" width={500} height={500} />
  </picture>;
}

function PartnerBanner() {
  const { t, locale } = useLocale();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || interacting) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !motion.matches)
        setIndex((value) => (value + 1) % banners.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [paused, interacting]);
  const banner = banners[index];
  return (
    <div
      className={styles.partnerBanner}
      aria-roledescription={t("캐러셀")}
      aria-label={locale === "ko" ? "GuideME 안내 배너" : "GuideME highlights"}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setInteracting(false);
      }}
    >
      <BannerArtwork name={banner.artwork} paused={paused || interacting} />
      <strong>{locale === "ko" ? banner.nameKo : banner.name}</strong>
      <p>{locale === "ko" ? banner.textKo : banner.text}</p>
      <a href={banner.href}>{locale === "ko" ? "자세히 보기" : "Explore"}<ArrowUpRight size={16} aria-hidden="true" /></a>
      <div className={styles.carouselControls}>
        <span>{String(index + 1).padStart(2, "0")} / 05</span>
        <button
          aria-label={locale === "ko" ? "이전 배너" : "Previous banner"}
          onClick={() =>
            setIndex((index + banners.length - 1) % banners.length)
          }
        >
          <ChevronLeft size={17} />
        </button>
        <button
          aria-label={locale === "ko" ? "다음 배너" : "Next banner"}
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
  if (!magazine.countryCode) return null;
  return <div className={styles.magazineNotice} aria-busy={magazine.loading}>
    {name && <strong>{name} · {t("Roller’s Dispatch")}</strong>}
    {(magazine.loading || magazine.failed || !magazine.articles.length) && <p role={magazine.failed ? "alert" : "status"}>
      {magazine.loading ? t("매거진 기사를 불러오고 있어요.")
        : magazine.failed ? t("매거진 기사를 불러오지 못했어요. 다시 시도해 주세요.")
        : t("이 국가에 등록된 매거진 기사가 아직 없어요.")}
    </p>}
    {magazine.failed && <button type="button" onClick={magazine.retry}>{t("다시 시도")}</button>}
    {magazine.hasMore && <button type="button" disabled={magazine.loading} onClick={magazine.loadMore}>{t("기사 더 보기")}</button>}
  </div>;
}

function ServiceBanner({ kind }: { kind: "deal" | "stay" }) {
  const { locale } = useLocale();
  const isDeal = kind === "deal";
  return (
    <div id={isDeal ? "deal-promo" : "stay-promo"} className={styles.serviceBanner}>
      <Image
        unoptimized
        src={isDeal ? homeMediaUrl(`dealme-${locale}.jpg`) : homeMediaUrl("restme-banner.jpg")}
        alt={isDeal ? (locale === "ko" ? "DealME 웰컴 쿠폰팩 — Coming Soon" : "DealME Welcome Coupon Pack — Coming Soon") : "Stay with Roller — Your home in Korea for a month or more. Service starts October 15th."}
        fill
        sizes="(max-width: 767px) 100vw, 1200px"
      />

    </div>
  );
}

function ServicePromotions() {
  const { locale } = useLocale();
  const ko = locale === "ko";
  const [index, setIndex] = useState(0);
  const services = [
    { name: "WinkME", href: partnerLinks.wink, artwork: "service-wink" },
    { name: "GiftME", href: partnerLinks.gift, artwork: "service-gift" },
    { name: "CarryME", href: "#app-download", artwork: "service-carry" },
  ];
  const service = services[index];
  return (
    <div className={styles.servicePromotions} aria-label={ko ? "GuideME 서비스" : "GuideME services"}>
      <a href={service.href} target="_parent" rel="noopener noreferrer">
        <BannerArtwork name={service.artwork} />
        <strong>{service.name}</strong>
        <span>{index === 2 ? (ko ? "앱 다운로드" : "Get the app") : (ko ? "서비스 둘러보기" : `Explore ${service.name}`)}<ArrowUpRight size={16} /></span>
      </a>
      <div className={styles.promoControls}>
        {services.map((item, itemIndex) => <button key={item.name} type="button" aria-label={item.name} aria-pressed={index === itemIndex} onClick={() => setIndex(itemIndex)} />)}
      </div>
    </div>
  );
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
  const isBannerTab = category === "deal" || category === "stay";
  const isWidgetTab = category === "flight" || category === "tour";
  const total = isBannerTab ? 1 : visiblePicks.length + visibleArticles.length;
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
        {!isWidgetTab && <label className={styles.contentSearch}>
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
        </label>}
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
        {!isWidgetTab && <div
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
        </div>}
      </div>
      {(category === "all" || category === "magazine") && <MagazineNotice magazine={magazine} />}
      <div
        ref={panelRef}
        id="home-content-panel"
        role="tabpanel"
        aria-labelledby={`home-tab-${category}`}
        tabIndex={0}
      >
        {!isWidgetTab && <span className={styles.srOnly} role="status">{locale === "ko" ? `콘텐츠 ${total}개` : `${total} ${total === 1 ? "item" : "items"}`}</span>}
        {category === "flight" || category === "tour" ? <PartnerWidget key={category} kind={category} /> : category === "deal" ? <ServiceBanner kind="deal" /> : category === "stay" ? <ServiceBanner kind="stay" /> : <div
          className={view === "grid" ? styles.pickGrid : styles.pickList}
          data-count={pagePicks.length + pageArticles.length}
          data-layout={
            category === "all" && pagePicks.length + pageArticles.length >= 6
              ? "mosaic"
              : "balanced"
          }
        >
          {pagePicks.map((pick) => (
            <a
              key={pick.id}
              className={`${styles.pickCard} ${pick.category === "flight" ? styles.flightCard : ""}`}
              href={pick.href}
              target="_parent"
              rel={pick.category === "stay" ? undefined : "sponsored noopener noreferrer"}
            >
              <Image
                unoptimized
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
                </span>
              </div>
            </a>
          ))}
          {pageArticles.map((article) => (
            <a
              className={styles.articleCard}
              key={article.id}
              href={article.href}
              target="_parent"
              rel="noopener noreferrer"
            >
              <ArticleImage article={article} />
              <span className={styles.eyebrow}>{t("ROLLER’S DISPATCH")}</span>
              <h3 lang={article.language}>{article.title}</h3>
              <p lang={article.language}>{article.summary}</p>
              <span>{t("기사 읽기")}<ArrowUpRight size={18} aria-hidden="true" />
              </span>
            </a>
          ))}
          {category === "all" && <ServicePromotions />}
        </div>}
        {category === "all" && <><div className={styles.inlineServiceBanners}><ServiceBanner kind="deal" /><ServiceBanner kind="stay" /></div></>}
        {!isWidgetTab && !isBannerTab && !visiblePicks.length && !visibleArticles.length && (category !== "magazine" || (!magazine.loading && !magazine.failed && !!magazine.countryCode && articles.length > 0)) && (
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
      {total > 0 && !isBannerTab && !isWidgetTab && (
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
          unoptimized
          src={homeMediaUrl("hero-autumn.jpg")}
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
          <a href="#guide-app" className={styles.joinButton}>JOIN NOW</a>
          <div className={styles.headerTools}>
            <a href="guideme://help-me/intro" aria-label={locale === "ko" ? "GuideME 앱에서 HelpME 열기" : "Open HelpME in the GuideME app"} title="HelpME"><CircleHelp size={28} aria-hidden="true" /></a>
            <LanguageSwitcher compact />
          </div>
        </header>
        <div className={styles.heroCopy} lang="en">
          <span className={styles.eyebrow}>DISCOVER YOUR NEXT</span>
          <h1>For ME,{" "}<br />By Human Touch,<br />
            <span>With GuideME!</span>
          </h1>
          <p>Connecting Hearts Across Borders: A Journey for Every You in the World</p>

        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.searchDock}>{children}</div>
        <section
          className={styles.mediaSection}
          aria-label={t("GuideME 소개와 여행 서비스")}
        >
          <div className={styles.mainVideo}>
            <video controls playsInline preload="none" poster={homeMediaUrl("roller-cover.png")} src={homeMediaUrl("roller-feature.mp4")} aria-label={locale === "ko" ? "롤러 소개 영상" : "Roller introduction video"} />
          </div>
          <div className={styles.mediaAside}>
            <div className={styles.smallVideo}>
              <video
                controls
                playsInline
                preload="none"
                poster={homeMediaUrl("guideme-cover.png")}
                src={homeMediaUrl("guideme-feature.mp4")}
                aria-label={t("GuideME 소개 영상")}
              >{t("브라우저가 영상 재생을 지원하지 않습니다.")}{" "}
                <a href={homeMediaUrl("guideme-feature.mp4")}>{t("소개 영상 열기")}</a>
              </video>

            </div>
            <PartnerBanner />
          </div>
        </section>
        <SavedContentExplorer articles={articles} magazine={magazine} />
        <section className={styles.thrillSection} aria-labelledby="thrill-title">
          <div><span className={styles.thrillEyebrow}>Only The Best Quality For You</span><h2 id="thrill-title">Thrill<span>ME</span></h2><p>{locale === "ko" ? "현장의 짜릿함을 온몸으로! 차원이 다른 최고의 직관 경험" : "Feel the excitement. Experience the best moments, live."}</p></div>
          <video controls playsInline preload="none" poster={homeMediaUrl("thrillme-cover.png")} src={homeMediaUrl("thrillme-feature.mp4")} aria-label={locale === "ko" ? "ThrillME 소개 영상" : "ThrillME introduction video"} />
        </section>
        <div className={styles.advertising} aria-label={locale === "ko" ? "광고 영역" : "Advertisement"}><Image unoptimized src={homeMediaUrl("advertisement-design.jpg")} alt="Guam International Dance Festival 2026 — December 4, 5 and 6" fill sizes="(max-width: 767px) 100vw, 1480px" /></div>
        <section id="rollers" className={styles.rollersSection} aria-labelledby="rollers-title">
          <a className={styles.rollerFeature} href="#discover">
            <Image unoptimized src={homeMediaUrl("roller-landscape.jpg")} alt="" fill sizes="(max-width: 767px) 100vw, 1000px" />
            <div><span className={styles.eyebrow}>TRAVEL</span><h2 id="rollers-title">The Ultimate<br />FOMO-Proof<br />Guide</h2><span className={styles.featureArrow}><ArrowRight size={24} aria-label={locale === "ko" ? "여행 콘텐츠 둘러보기" : "Explore travel stories"} /></span></div>
          </a>
          <RollerCards />
        </section>
        <section
          id="app-download"
          className={styles.appCta}
          aria-labelledby="app-title"
        >
          <h2 id="app-title">Your journey begins here.</h2>
          <p>{locale === "ko" ? "GuideME 앱에서 여행을 계속하세요." : "Continue your journey with the GuideME app."}</p>
          <a href="#guide-app" className={styles.blueButton}>{locale === "ko" ? "GuideME 앱 다운로드" : "Get the GuideME app"}<ArrowRight size={18} aria-hidden="true" /></a>
        </section>
      </div>
      <HomeClosingSections />
    </main>
  );
}
