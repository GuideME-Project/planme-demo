"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type NaverMapPoint = {
  lat: number;
  lng: number;
};

type NaverRouteGuide = {
  distanceMeters: number;
  durationMs: number;
  instruction: string;
  pointIndex: number;
};

type NaverRouteResponse = {
  configured: boolean;
  message?: string;
  ok: boolean;
  route: {
    guides: NaverRouteGuide[];
    path: NaverMapPoint[];
    summary: {
      distanceMeters: number;
      durationMs: number;
    };
  };
  source: "mock" | "naver" | "naver-empty" | "naver-error";
};

type RollerStateId = "ready" | "moving" | "near" | "offroute" | "luggage";

type RollerState = {
  bubble: string;
  color: string;
  description: string;
  id: RollerStateId;
  label: string;
  mood: string;
};

type NaverLatLng = {
  lat: () => number;
  lng: () => number;
};

type NaverMapInstance = object;

type NaverMarkerIcon = {
  anchor?: NaverPoint;
  content?: string;
  size?: NaverSize;
  url?: string;
};

type NaverMarker = {
  setIcon: (icon: NaverMarkerIcon) => void;
};

type NaverPoint = object;

type NaverSize = object;

type NaverMapsNamespace = {
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  LatLngBounds: new () => {
    extend: (point: NaverLatLng) => void;
  };
  Map: new (
    element: HTMLElement,
    options: {
      center: NaverLatLng;
      logoControlOptions?: {
        position: string;
      };
      scaleControl?: boolean;
      zoom: number;
      zoomControl?: boolean;
    },
  ) => NaverMapInstance & {
    fitBounds: (bounds: object) => void;
  };
  Marker: new (options: {
    icon: NaverMarkerIcon;
    map: NaverMapInstance;
    position: NaverLatLng;
  }) => NaverMarker;
  Point: new (x: number, y: number) => NaverPoint;
  Polyline: new (options: {
    map: NaverMapInstance;
    path: NaverLatLng[];
    strokeColor: string;
    strokeOpacity: number;
    strokeWeight: number;
  }) => object;
  Position: {
    BOTTOM_RIGHT: string;
  };
  Size: new (width: number, height: number) => NaverSize;
};

declare global {
  interface Window {
    naver?: {
      maps?: NaverMapsNamespace;
    };
  }
}

const rollerStates: RollerState[] = [
  {
    bubble: "출발 준비 완료!",
    color: "#2563eb",
    description: "일정 시작 전 기본 안내 상태",
    id: "ready",
    label: "출발 전",
    mood: "🚩",
  },
  {
    bubble: "Follow me!",
    color: "#16a34a",
    description: "경로를 따라 이동 중인 상태",
    id: "moving",
    label: "이동 중",
    mood: "🪽",
  },
  {
    bubble: "거의 다 왔어요.",
    color: "#ec4899",
    description: "목적지 100m 이내로 들어온 상태",
    id: "near",
    label: "목적지 근접",
    mood: "💗",
  },
  {
    bubble: "잠깐, 이쪽이 아니에요!",
    color: "#f59e0b",
    description: "현재 위치가 예정 경로에서 벗어난 상태",
    id: "offroute",
    label: "경로 이탈",
    mood: "❓",
  },
  {
    bubble: "짐은 맡겼어요. 바로 출발해요!",
    color: "#0f766e",
    description: "CarryME 짐 탁송 상태가 완료된 상태",
    id: "luggage",
    label: "짐 탁송 완료",
    mood: "🏅",
  },
];

const fallbackPath: NaverMapPoint[] = [
  { lat: 37.554722, lng: 126.970833 },
  { lat: 37.55756, lng: 126.97625 },
  { lat: 37.55982, lng: 126.98212 },
  { lat: 37.56104, lng: 126.98648 },
];

type NaverRollerMapPoCProps = {
  naverMapsClientId: string;
};

/**
 * Renders a Naver Maps integration PoC that works after keys are registered.
 */
export function NaverRollerMapPoC({ naverMapsClientId }: NaverRollerMapPoCProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const rollerMarkerRef = useRef<NaverMarker | null>(null);
  const [activeState, setActiveState] = useState<RollerStateId>("near");
  const [routeData, setRouteData] = useState<NaverRouteResponse | null>(null);
  const [mapStatus, setMapStatus] = useState<"mock" | "loading" | "ready" | "error">(
    naverMapsClientId ? "loading" : "mock",
  );

  const selectedState = useMemo(
    () => rollerStates.find((state) => state.id === activeState) ?? rollerStates[0],
    [activeState],
  );

  useEffect(() => {
    let cancelled = false;

    /**
     * Loads the demo route from the server-side Naver Directions adapter.
     */
    async function loadRoute() {
      const response = await fetch("/api/naver/directions/demo");
      const data = (await response.json()) as NaverRouteResponse;

      if (!cancelled) {
        setRouteData(data);
      }
    }

    void loadRoute();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!naverMapsClientId || !mapElementRef.current) {
      return;
    }

    let cancelled = false;

    /**
     * Loads the Naver Maps JavaScript SDK once for the PoC page.
     */
    async function loadNaverMaps() {
      try {
        const maps = await loadNaverMapsScript(naverMapsClientId);

        if (cancelled || !mapElementRef.current) {
          return;
        }

        // Draw the route and Roller overlay after the SDK becomes available.
        renderNaverMap({
          container: mapElementRef.current,
          maps,
          onMarkerReady: (marker) => {
            rollerMarkerRef.current = marker;
            marker.setIcon(createRollerIcon(selectedState, maps));
          },
          path: routeData?.route.path ?? fallbackPath,
          state: selectedState,
        });
        setMapStatus("ready");
      } catch {
        setMapStatus("error");
      }
    }

    void loadNaverMaps();

    return () => {
      cancelled = true;
    };
  }, [naverMapsClientId, routeData, selectedState]);

  useEffect(() => {
    if (rollerMarkerRef.current && window.naver?.maps) {
      // setIcon verifies that Roller can change by PlanME route state at runtime.
      rollerMarkerRef.current.setIcon(createRollerIcon(selectedState, window.naver.maps));
    }
  }, [selectedState]);

  return (
    <main className="min-h-screen bg-[#eef3f8] px-6 py-6 text-[#152033]">
      <section className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-2 rounded-lg bg-white px-5 py-4 shadow-sm md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black text-emerald-700">PlanME by GuideME</p>
            <h1 className="text-3xl font-black tracking-normal">PlanME 네이버 롤러 지도 PoC</h1>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">
            NAVER 지도 SDK + PlanME 오버레이
          </span>
        </header>

        <section className="grid gap-4 lg:grid-cols-[0.42fr_0.58fr]">
          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-sm font-bold text-slate-500">현재 상태</p>
              <h2 className="mt-1 text-2xl font-black">{selectedState.label}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{selectedState.description}</p>
            </div>

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-500">롤러 말풍선</p>
              <p className="mt-2 text-lg font-black" style={{ color: selectedState.color }}>
                {selectedState.bubble}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {rollerStates.map((state) => (
                <button
                  key={state.id}
                  className="rounded-lg border px-3 py-3 text-left text-sm font-bold transition hover:border-emerald-500"
                  onClick={() => setActiveState(state.id)}
                  style={{
                    background: state.id === activeState ? "#ecfdf5" : "#ffffff",
                    borderColor: state.id === activeState ? "#10b981" : "#d8dee9",
                    color: state.id === activeState ? "#047857" : "#334155",
                  }}
                  type="button"
                >
                  <span className="mr-2">{state.mood}</span>
                  {state.label}
                </button>
              ))}
            </div>

            <div
              className={`mt-5 rounded-lg border p-4 text-sm leading-6 ${
                naverMapsClientId
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <p className="font-black">
                {naverMapsClientId ? "지도 키 등록 완료" : "필요한 키"}
              </p>
              {naverMapsClientId ? (
                <>
                  <p className="mt-2">네이버 지도 SDK를 사용해 지도를 표시합니다.</p>
                  <p>
                    Directions:{" "}
                    {routeData?.source === "naver" ? "Naver Directions 5 응답 사용 중" : "확인 중"}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2">
                    지도 표시: <code>NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID</code>
                  </p>
                  <p>
                    Directions: <code>NAVER_MAPS_CLIENT_ID</code>,{" "}
                    <code>NAVER_MAPS_CLIENT_SECRET</code>
                  </p>
                </>
              )}
            </div>
          </aside>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-black">서울역 → 명동 호텔</h2>
                <p className="text-sm text-slate-500">
                  {routeData?.source === "naver"
                    ? "Naver Directions 5 응답 사용 중"
                    : "키 등록 전에는 mock 경로로 UI만 검증합니다."}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {mapStatus === "ready"
                  ? "Naver 지도 로드됨"
                  : mapStatus === "loading"
                    ? "지도 로딩 중"
                    : mapStatus === "error"
                      ? "지도 로드 실패"
                      : "Mock 지도"}
              </span>
            </div>

            <div className="relative min-h-[430px] overflow-hidden rounded-lg border border-slate-200">
              <div className="absolute inset-0">
                <div ref={mapElementRef} className="h-full w-full" />
              </div>
              {mapStatus !== "ready" ? (
                <MockMapPreview selectedState={selectedState} />
              ) : null}
              <div className="absolute bottom-3 right-3 rounded bg-white/90 px-3 py-2 text-xs font-bold text-slate-500 shadow">
                지도 저작권/로고 영역 보호
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              {(routeData?.route.guides ?? []).slice(0, 4).map((guide, index) => (
                <div key={`${guide.pointIndex}-${guide.instruction}`} className="rounded-lg bg-slate-50 px-4 py-3">
                  <p className="text-sm font-black text-slate-800">
                    {index + 1}. {guide.instruction}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    약 {Math.max(1, Math.round(guide.distanceMeters))}m
                  </p>
                </div>
              ))}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

/**
 * Loads the Naver Maps SDK script with the public client id.
 */
function loadNaverMapsScript(clientId: string): Promise<NaverMapsNamespace> {
  if (window.naver?.maps) {
    return Promise.resolve(window.naver.maps);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const params = new URLSearchParams({ ncpKeyId: clientId });

    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("naver-map-script-load-failed"));
    script.onload = () => {
      if (window.naver?.maps) {
        resolve(window.naver.maps);
        return;
      }

      reject(new Error("naver-map-namespace-missing"));
    };
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${params.toString()}`;
    document.head.append(script);
  });
}

/**
 * Renders the actual Naver map, route polyline, and Roller marker.
 */
function renderNaverMap({
  container,
  maps,
  onMarkerReady,
  path,
  state,
}: {
  container: HTMLElement;
  maps: NaverMapsNamespace;
  onMarkerReady: (marker: NaverMarker) => void;
  path: NaverMapPoint[];
  state: RollerState;
}) {
  const routePath = path.map((point) => new maps.LatLng(point.lat, point.lng));
  const center = routePath[Math.floor(routePath.length / 2)] ?? new maps.LatLng(37.558, 126.979);
  const map = new maps.Map(container, {
    center,
    logoControlOptions: { position: maps.Position.BOTTOM_RIGHT },
    scaleControl: true,
    zoom: 14,
    zoomControl: true,
  });
  const bounds = new maps.LatLngBounds();

  // Draw one route line and fit the viewport around every route point.
  routePath.forEach((point) => bounds.extend(point));
  new maps.Polyline({
    map,
    path: routePath,
    strokeColor: "#2563eb",
    strokeOpacity: 0.88,
    strokeWeight: 5,
  });
  map.fitBounds(bounds);

  const markerPosition = routePath[Math.min(routePath.length - 1, Math.floor(routePath.length * 0.72))] ?? center;
  const marker = new maps.Marker({
    icon: createRollerIcon(state, maps),
    map,
    position: markerPosition,
  });

  onMarkerReady(marker);
}

/**
 * Builds an HTML marker icon that can be swapped with Marker.setIcon.
 */
function createRollerIcon(state: RollerState, maps: NaverMapsNamespace): NaverMarkerIcon {
  const content = `
    <div style="transform:translate(-50%, -100%); font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="display:flex; align-items:flex-end; gap:8px;">
        <div style="width:62px;height:62px;border-radius:999px;background:#d9f5ff;border:3px solid white;box-shadow:0 12px 28px rgba(15,23,42,.22);display:grid;place-items:center;font-size:28px;">
          ${state.mood}
        </div>
        <div style="max-width:190px;margin-bottom:20px;border:1px solid rgba(15,23,42,.12);border-radius:8px;background:white;padding:9px 11px;box-shadow:0 12px 28px rgba(15,23,42,.18);font-size:13px;font-weight:800;color:${state.color};white-space:nowrap;">
          ${state.bubble}
        </div>
      </div>
    </div>`;

  // HtmlIcon keeps the Roller bubble inside the PlanME overlay layer, not inside Naver's own UI.
  return {
    anchor: new maps.Point(31, 62),
    content,
    size: new maps.Size(260, 90),
  };
}

/**
 * Renders a keyless fallback so the PoC page remains usable before Naver keys are issued.
 */
function MockMapPreview({ selectedState }: { selectedState: RollerState }) {
  return (
    <div className="absolute inset-0 bg-[linear-gradient(rgba(37,99,235,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(37,99,235,.08)_1px,transparent_1px),linear-gradient(135deg,#e9f6ff,#f8fbff_48%,#eaf8f0)] bg-[length:44px_44px,44px_44px,auto]">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          fill="none"
          points="10,76 28,66 42,50 56,47 72,36 86,24"
          stroke="#2563eb"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        <polyline
          fill="none"
          points="55,48 64,43 72,36"
          stroke="#16a34a"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="5"
        />
      </svg>
      <div className="absolute left-[58%] top-[31%] flex items-end gap-2">
        <div className="grid h-16 w-16 place-items-center rounded-full border-[3px] border-white bg-sky-100 text-3xl shadow-xl">
          {selectedState.mood}
        </div>
        <div
          className="mb-5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black shadow-xl"
          style={{ color: selectedState.color }}
        >
          {selectedState.bubble}
        </div>
      </div>
    </div>
  );
}
