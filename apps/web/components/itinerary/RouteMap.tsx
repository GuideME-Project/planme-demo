import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import TrainRoundedIcon from "@mui/icons-material/TrainRounded";
import { alpha, Box, Stack, Typography, useTheme } from "@mui/material";
import type { MapCoordinate, MapPoint, RoutePlan } from "@planme/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanmeThemeMode } from "@/theme/theme";

type RouteMapProps = {
  attachedToComparison?: boolean;
  expanded?: boolean;
  standardRoute: RoutePlan;
  carrymeRoute: RoutePlan;
  savingLabel: string;
  showStandard: boolean;
  showCarryme: boolean;
  themeMode: PlanmeThemeMode;
};

const mapMarkers = [
  {
    id: "icn",
    label: "인천공항",
    icon: <FlightTakeoffRoundedIcon fontSize="small" />,
    x: 14,
    y: 22,
    tone: "primary",
  },
  {
    id: "seoul-station",
    label: "서울역",
    caption: "KTX 환승",
    icon: <TrainRoundedIcon fontSize="small" />,
    x: 25,
    y: 28,
    tone: "primary",
  },
  {
    id: "hotel",
    label: "서면 호텔",
    caption: "수하물 보관",
    icon: <HotelRoundedIcon fontSize="small" />,
    x: 78,
    y: 74,
    tone: "primary",
  },
  {
    id: "concert",
    label: "부산 공연장",
    caption: "BTS 공연 관람",
    icon: <AttractionsRoundedIcon fontSize="small" />,
    x: 84,
    y: 66,
    tone: "secondary",
  },
] as const;

const naverMapsClientId = process.env.NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID ?? "";

type NaverLatLng = {
  lat: () => number;
  lng: () => number;
};

type NaverMapInstance = {
  fitBounds: (bounds: object) => void;
};

type NaverPoint = object;
type NaverSize = object;
type NaverStrokeStyle = "solid" | "shortdash";

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
      scrollwheel?: boolean;
      zoom: number;
      zoomControl?: boolean;
    },
  ) => NaverMapInstance;
  Marker: new (options: {
    icon?: {
      anchor?: NaverPoint;
      content?: string;
      size?: NaverSize;
    };
    map: NaverMapInstance;
    position: NaverLatLng;
    title: string;
    zIndex?: number;
  }) => void;
  Point: new (x: number, y: number) => NaverPoint;
  Polyline: new (options: {
    map: NaverMapInstance;
    path: NaverLatLng[];
    strokeColor: string;
    strokeLineCap?: string;
    strokeLineJoin?: string;
    strokeOpacity?: number;
    strokeStyle?: NaverStrokeStyle;
    strokeWeight: number;
    zIndex?: number;
  }) => void;
  Position: {
    BOTTOM_RIGHT: string;
  };
  Size: new (width: number, height: number) => NaverSize;
};

type PlanmeNaverWindow = Window & {
  naver?: {
    maps?: NaverMapsNamespace;
  };
  planmeNaverMapsPromise?: Promise<NaverMapsNamespace>;
};

/**
 * Converts percentage coordinates into an SVG polyline point string.
 */
function toPointString(points: MapPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

type RollerGuidanceContent = {
  headline: string;
};

type RouteLineStyle = {
  opacity: number;
  strokeStyle: NaverStrokeStyle;
  strokeWeight: number;
  svgStrokeWidth: number;
  zIndex: number;
};

const rollerImageSrc = "/roller/roller-flying.png";
const rollerComfortHeadline = "캐리미로 짐을 이동하니, 편하게 관광할 수 있네요";
const rollerMapNotice = "CarryME 경로를 지도에서 확인해요.";
const routeLineStyles: Record<"standard" | "carryme", RouteLineStyle> = {
  carryme: {
    opacity: 0.96,
    strokeStyle: "solid",
    strokeWeight: 5,
    svgStrokeWidth: 1.45,
    zIndex: 20,
  },
  standard: {
    opacity: 0.82,
    strokeStyle: "shortdash",
    strokeWeight: 9,
    svgStrokeWidth: 2.2,
    zIndex: 10,
  },
};

/**
 * Builds the Roller copy agreed for CarryME benefit states.
 */
function createRollerGuidanceContent(savingLabel: string): RollerGuidanceContent {
  const savingDurationLabel = savingLabel.replace(/\s*절약$/, "").trim();

  // Keep the map bubble in sync with the same saving label used by the header and timeline.
  return {
    headline:
      savingDurationLabel && savingDurationLabel !== "절약 없음"
        ? `캐리미로 짐을 이동하니, 관광할 시간이 ${savingDurationLabel} 더 많아졌어요`
        : rollerComfortHeadline,
  };
}

/**
 * Returns the first available route coordinate without forcing separate segments together.
 */
function getFirstRouteCoordinate(route: RoutePlan) {
  return route.geoSegments?.find((segment) => segment.length > 0)?.[0];
}

/**
 * Loads the Naver Maps JavaScript SDK once for the PlanME route map.
 */
function loadNaverMaps(clientId: string): Promise<NaverMapsNamespace> {
  const naverWindow = window as PlanmeNaverWindow;

  if (naverWindow.naver?.maps) {
    return Promise.resolve(naverWindow.naver.maps);
  }

  if (naverWindow.planmeNaverMapsPromise) {
    return naverWindow.planmeNaverMapsPromise;
  }

  naverWindow.planmeNaverMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const params = new URLSearchParams({
      ncpKeyId: clientId,
    });

    // Naver Maps SDK is loaded lazily so route data can still render with the static fallback.
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Naver Maps JavaScript SDK failed to load"));
    script.onload = () => {
      if (naverWindow.naver?.maps) {
        resolve(naverWindow.naver.maps);
        return;
      }

      reject(new Error("Naver Maps namespace was not initialized"));
    };
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${params.toString()}`;
    document.head.append(script);
  });

  return naverWindow.planmeNaverMapsPromise;
}

type NaverRouteMapProps = {
  carrymeColor: string;
  carrymeRoute: RoutePlan;
  onLoadFailed: () => void;
  showCarryme: boolean;
  showStandard: boolean;
  standardColor: string;
  standardRoute: RoutePlan;
};

/**
 * Renders the real Naver Maps route overlay for the PlanME demo.
 */
function NaverRouteMap({
  carrymeColor,
  carrymeRoute,
  onLoadFailed,
  showCarryme,
  showStandard,
  standardColor,
  standardRoute,
}: NaverRouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const markers = useMemo(
    () => standardRoute.stops.filter((stop) => Boolean(stop.coordinate)),
    [standardRoute.stops],
  );

  useEffect(() => {
    let cancelled = false;

    if (!naverMapsClientId || !mapElementRef.current) {
      return;
    }

    async function renderMap(clientId: string): Promise<void> {
      try {
        const maps = await loadNaverMaps(clientId);

        if (cancelled || !mapElementRef.current) {
          return;
        }

        const firstCoordinate =
          getFirstRouteCoordinate(standardRoute) ??
          getFirstRouteCoordinate(carrymeRoute) ??
          standardRoute.stops[0]?.coordinate ??
          carrymeRoute.stops[0]?.coordinate;
        const center = new maps.LatLng(
          firstCoordinate?.lat ?? 36.2,
          firstCoordinate?.lng ?? 127.9,
        );

        mapElementRef.current.replaceChildren();

        const map = new maps.Map(mapElementRef.current, {
          center,
          logoControlOptions: { position: maps.Position.BOTTOM_RIGHT },
          scaleControl: true,
          scrollwheel: true,
          zoom: 10,
          zoomControl: true,
        });
        const bounds = new maps.LatLngBounds();
        let hasBounds = false;

        const addRouteSegment = (
          path: MapCoordinate[],
          color: string,
          routeStyle: RouteLineStyle,
        ) => {
          if (path.length <= 2) {
            return;
          }

          const naverPath = path.map((point) => new maps.LatLng(point.lat, point.lng));

          // Keep map bounds in sync with every visible route segment.
          naverPath.forEach((point) => {
            bounds.extend(point);
            hasBounds = true;
          });
          new maps.Polyline({
            map,
            path: naverPath,
            strokeColor: color,
            strokeLineCap: "round",
            strokeLineJoin: "round",
            strokeOpacity: routeStyle.opacity,
            strokeStyle: routeStyle.strokeStyle,
            strokeWeight: routeStyle.strokeWeight,
            zIndex: routeStyle.zIndex,
          });
        };

        const addRoute = (
          route: RoutePlan,
          color: string,
          routeStyle: RouteLineStyle,
        ) => {
          const segments = route.geoSegments?.filter((segment) => segment.length > 2);

          if (segments?.length) {
            segments.forEach((segment) => addRouteSegment(segment, color, routeStyle));
            return;
          }

          if (route.geoPath?.length) {
            addRouteSegment(route.geoPath, color, routeStyle);
          }
        };

        if (showStandard) {
          addRoute(standardRoute, standardColor, routeLineStyles.standard);
        }

        if (showCarryme) {
          addRoute(carrymeRoute, carrymeColor, routeLineStyles.carryme);
        }

        markers.forEach((marker, index) => {
          if (!marker.coordinate) {
            return;
          }

          const markerPosition = new maps.LatLng(marker.coordinate.lat, marker.coordinate.lng);
          const isCarrymeMarker = marker.label.includes("캐리미");

          bounds.extend(markerPosition);
          hasBounds = true;
          new maps.Marker({
            ...createNaverMarkerIcon({
              color: isCarrymeMarker ? carrymeColor : standardColor,
              index: index + 1,
              label: marker.label,
              maps,
            }),
            map,
            position: markerPosition,
            title: marker.label,
          });
        });

        if (hasBounds) {
          map.fitBounds(bounds);
        }
      } catch {
        // Naver key or browser restrictions can fail independently from the demo route data.
        onLoadFailed();
      }
    }

    void renderMap(naverMapsClientId);

    return () => {
      cancelled = true;
    };
  }, [
    carrymeColor,
    carrymeRoute,
    carrymeRoute.geoSegments,
    markers,
    onLoadFailed,
    showCarryme,
    showStandard,
    standardColor,
    standardRoute,
    standardRoute.geoSegments,
  ]);

  return (
    <Box sx={{ minHeight: { xs: 320, md: 360 }, position: "relative" }}>
      <Box sx={{ inset: 0, position: "absolute" }}>
        <Box ref={mapElementRef} sx={{ height: "100%", width: "100%" }} />
      </Box>
      <Stack
        spacing={0.8}
        sx={{
          bgcolor: alpha("#ffffff", 0.9),
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          bottom: 18,
          p: 1.2,
          position: "absolute",
          right: 18,
          zIndex: 2,
        }}
      >
        <LegendRow color={standardColor} label="Standard 경로" />
        <LegendRow color={carrymeColor} label="CarryME 경로" />
      </Stack>
    </Box>
  );
}

/**
 * Builds an HTML marker for Naver Maps without depending on image assets.
 */
function createNaverMarkerIcon({
  color,
  index,
  label,
  maps,
}: {
  color: string;
  index: number;
  label: string;
  maps: NaverMapsNamespace;
}): {
  icon: {
    anchor: NaverPoint;
    content: string;
    size: NaverSize;
  };
  zIndex: number;
} {
  const content = `
    <div style="position:relative;width:180px;height:76px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:none;">
      <div style="position:absolute;left:73px;top:0;display:grid;place-items:center;width:34px;height:34px;border-radius:999px;background:${color};border:3px solid #fff;box-shadow:0 10px 24px rgba(15,23,42,.22);color:#fff;font-size:12px;font-weight:900;">
        ${index}
      </div>
      <div style="position:absolute;left:50%;top:39px;transform:translateX(-50%);white-space:nowrap;border:1px solid rgba(15,23,42,.12);border-radius:8px;background:white;padding:5px 8px;box-shadow:0 8px 20px rgba(15,23,42,.12);color:#172033;font-size:11px;font-weight:800;">
        ${label}
      </div>
    </div>`;

  return {
    // Anchor the geographic coordinate to the center of the fixed-size marker circle.
    icon: {
      anchor: new maps.Point(90, 17),
      content,
      size: new maps.Size(180, 76),
    },
    zIndex: 200,
  };
}

/**
 * Renders the compact Roller badge used in CarryME guidance overlays.
 */
function RollerBadge({ isDark }: { isDark: boolean }) {
  return (
    <Box
      alt=""
      aria-hidden="true"
      component="img"
      data-planme-roller-motion="wing-flap"
      src={rollerImageSrc}
      sx={{
        animation: "planmeRollerWingFlap 0.72s ease-in-out infinite",
        display: "block",
        flexShrink: 0,
        filter: isDark
          ? "drop-shadow(0 16px 26px rgba(0,0,0,0.42))"
          : "drop-shadow(0 16px 24px rgba(15,23,42,0.24))",
        height: { xs: 58, md: 82 },
        objectFit: "contain",
        transformOrigin: "50% 55%",
        willChange: "transform",
        width: { xs: 72, md: 108 },
        "@keyframes planmeRollerWingFlap": {
          "0%, 100%": { transform: "translate3d(0, 2px, 0) rotate(-1deg) scaleY(1)" },
          "45%": { transform: "translate3d(0, -4px, 0) rotate(1deg) scaleY(0.94)" },
          "65%": { transform: "translate3d(0, -2px, 0) rotate(-0.5deg) scaleY(1.03)" },
        },
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
        },
      }}
    />
  );
}

/**
 * Shows CarryME benefit copy as a map-anchored Roller guide with mobile fallback.
 */
function RollerGuidance({
  content,
  isDark,
  show,
}: {
  content: RollerGuidanceContent;
  isDark: boolean;
  show: boolean;
}) {
  if (!show) {
    return null;
  }

  return (
    <>
      <Stack
        data-planme-roller-guidance="anchor"
        direction="row"
        spacing={1.2}
        sx={{
          alignItems: "center",
          display: { xs: "none", md: "flex" },
          maxWidth: 348,
          pointerEvents: "none",
          position: "absolute",
          right: { md: 14, lg: 20 },
          top: { md: 22, lg: 28 },
          zIndex: 4,
        }}
      >
        <Box
          sx={{
            bgcolor: isDark ? alpha("#0f1720", 0.92) : alpha("#ffffff", 0.96),
            border: "1px solid",
            borderColor: isDark ? alpha("#ffffff", 0.18) : alpha("#0f1720", 0.14),
            borderRadius: 2,
            boxShadow: isDark
              ? "0 18px 38px rgba(0,0,0,0.34)"
              : "0 18px 38px rgba(15,23,42,0.16)",
            color: "text.primary",
            maxWidth: 230,
            p: 1.4,
            position: "relative",
            "&::after": {
              borderBottom: "9px solid transparent",
              borderLeft: `10px solid ${isDark ? alpha("#0f1720", 0.92) : alpha("#ffffff", 0.96)}`,
              borderTop: "9px solid transparent",
              content: '""',
              position: "absolute",
              right: -10,
              top: "50%",
              transform: "translateY(-50%)",
            },
          }}
        >
          <Typography sx={{ fontSize: 14, fontWeight: 900, lineHeight: 1.35 }}>
            {content.headline}
          </Typography>
        </Box>
        <RollerBadge isDark={isDark} />
      </Stack>

      <Stack
        data-planme-roller-guidance="panel"
        direction="row"
        spacing={1.2}
        sx={{
          alignItems: "center",
          bgcolor: isDark ? alpha("#0f1720", 0.9) : alpha("#ffffff", 0.95),
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          bottom: 14,
          boxShadow: isDark
            ? "0 18px 38px rgba(0,0,0,0.32)"
            : "0 18px 38px rgba(15,23,42,0.14)",
          display: { xs: "flex", md: "none" },
          left: 14,
          pointerEvents: "none",
          position: "absolute",
          right: 14,
          zIndex: 4,
          px: 1.3,
          py: 1.1,
          width: "min(calc(100% - 28px), calc(100vw - 56px))",
        }}
      >
        <RollerBadge isDark={isDark} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{ fontSize: 13, fontWeight: 900, lineHeight: 1.35, overflowWrap: "break-word" }}
          >
            {content.headline}
          </Typography>
        </Box>
      </Stack>
    </>
  );
}

/**
 * Renders a Naver-backed route view with a static fallback.
 */
export function RouteMap({
  attachedToComparison = false,
  expanded = false,
  standardRoute,
  carrymeRoute,
  savingLabel,
  showStandard,
  showCarryme,
  themeMode,
}: RouteMapProps) {
  const theme = useTheme();
  const [naverFailed, setNaverFailed] = useState(false);
  const handleNaverLoadFailed = useCallback(() => setNaverFailed(true), []);
  const isDark = themeMode === "dark";
  const standardColor = theme.palette.primary.main;
  const carrymeColor = theme.palette.secondary.main;
  const rollerGuidance = createRollerGuidanceContent(savingLabel);
  const canUseNaver = Boolean(naverMapsClientId && !naverFailed);
  const mapBackground = isDark
    ? "linear-gradient(135deg, #111827 0%, #17212d 48%, #0e2530 100%)"
    : "linear-gradient(135deg, #dceeff 0%, #f6fbff 48%, #e9f8ec 100%)";
  // The detail-map tab intentionally trades editing access for a taller inspection surface.
  const mapMinHeight = expanded
    ? { xs: 560, md: 620, lg: 680 }
    : { xs: 320, md: 360 };

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid",
        borderTop: attachedToComparison ? 0 : "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        borderTopLeftRadius: attachedToComparison ? 0 : 8,
        borderTopRightRadius: attachedToComparison ? 0 : 8,
        overflow: "hidden",
      }}
    >
      <Box
        data-testid="route-map-viewport"
        sx={{
          background: mapBackground,
          minHeight: mapMinHeight,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {canUseNaver ? (
        <NaverRouteMap
          carrymeColor={carrymeColor}
          carrymeRoute={carrymeRoute}
          onLoadFailed={handleNaverLoadFailed}
          showCarryme={showCarryme}
          showStandard={showStandard}
          standardColor={standardColor}
          standardRoute={standardRoute}
        />
      ) : (
        <>
      <Box
        sx={{
          backgroundImage: isDark
            ? "linear-gradient(rgba(148, 163, 184, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px)"
            : "linear-gradient(rgba(37, 99, 235, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235, 0.1) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          inset: 0,
          opacity: isDark ? 0.5 : 0.85,
          position: "absolute",
        }}
      />
      <Box
        sx={{
          background: isDark
            ? "linear-gradient(90deg, rgba(14, 165, 233, 0.22), rgba(14, 165, 233, 0.04))"
            : "linear-gradient(90deg, rgba(56, 189, 248, 0.25), rgba(56, 189, 248, 0.04))",
          borderRadius: "50%",
          bottom: "-18%",
          height: "58%",
          left: "-8%",
          position: "absolute",
          transform: "rotate(-8deg)",
          width: "68%",
        }}
      />

      <Box
        component="svg"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        sx={{
          height: "100%",
          inset: 0,
          position: "absolute",
          width: "100%",
        }}
      >
        <defs>
          <marker
            id="standardArrow"
            markerHeight="4"
            markerUnits="strokeWidth"
            markerWidth="4"
            orient="auto"
            refX="4"
            refY="2"
            viewBox="0 0 4 4"
          >
            <path d="M0,0 L4,2 L0,4 Z" fill={standardColor} />
          </marker>
          <marker
            id="carrymeArrow"
            markerHeight="4"
            markerUnits="strokeWidth"
            markerWidth="4"
            orient="auto"
            refX="4"
            refY="2"
            viewBox="0 0 4 4"
          >
            <path d="M0,0 L4,2 L0,4 Z" fill={carrymeColor} />
          </marker>
        </defs>

        {showStandard ? (
          <polyline
            fill="none"
            markerMid="url(#standardArrow)"
            markerEnd="url(#standardArrow)"
            points={toPointString(standardRoute.mapPath)}
            stroke={standardColor}
            strokeDasharray="5 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={routeLineStyles.standard.opacity}
            strokeWidth={routeLineStyles.standard.svgStrokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {showCarryme ? (
          <polyline
            fill="none"
            markerMid="url(#carrymeArrow)"
            markerEnd="url(#carrymeArrow)"
            points={toPointString(carrymeRoute.mapPath)}
            stroke={carrymeColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={routeLineStyles.carryme.opacity}
            strokeWidth={routeLineStyles.carryme.svgStrokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

      </Box>

      {mapMarkers.map((marker) => (
        <Stack
          key={marker.id}
          spacing={0.5}
          sx={{
            alignItems: "center",
            left: `${marker.x}%`,
            position: "absolute",
            top: `${marker.y}%`,
            transform: "translate(-50%, -50%)",
            zIndex: 2,
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              bgcolor:
                marker.tone === "secondary" ? "secondary.main" : "primary.main",
              border: "3px solid",
              borderColor: isDark ? "#0f1720" : "#ffffff",
              borderRadius: "999px",
              boxShadow:
                marker.tone === "secondary"
                  ? `0 10px 28px ${alpha(carrymeColor, 0.35)}`
                  : `0 10px 28px ${alpha(standardColor, 0.32)}`,
              color: "#fff",
              display: "flex",
              height: 42,
              justifyContent: "center",
              width: 42,
            }}
          >
            {marker.icon}
          </Box>
          <Box
            sx={{
              bgcolor: isDark ? alpha("#0f1720", 0.9) : alpha("#ffffff", 0.92),
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1.5,
              boxShadow: isDark
                ? "0 10px 24px rgba(0,0,0,0.28)"
                : "0 10px 24px rgba(23, 32, 51, 0.12)",
              px: 1.2,
              py: 0.75,
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 800 }}>
              {marker.label}
            </Typography>
            {"caption" in marker ? (
              <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                {marker.caption}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      ))}

      <Stack
        spacing={0.8}
        sx={{
          bgcolor: isDark ? alpha("#0f1720", 0.84) : alpha("#ffffff", 0.9),
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          bottom: 18,
          p: 1.2,
          position: "absolute",
          right: 18,
          zIndex: 2,
        }}
      >
        <LegendRow color={standardColor} label="Standard 경로" />
        <LegendRow color={carrymeColor} label="CarryME 경로" />
      </Stack>
        </>
      )}
        <RollerGuidance content={rollerGuidance} isDark={isDark} show={showCarryme} />
      </Box>

      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          bgcolor: isDark ? alpha(standardColor, 0.1) : alpha("#eff6ff", 0.92),
          border: "1px solid",
          borderColor: isDark ? alpha(standardColor, 0.28) : "#bfdbfe",
          borderRadius: 1.5,
          m: { xs: 1.25, md: 1.5 },
          px: { xs: 1.5, md: 2 },
          py: 1.25,
          width: { xs: "min(calc(100% - 20px), calc(100vw - 56px))", md: "auto" },
        }}
      >
        <InfoRoundedIcon color="primary" fontSize="small" />
        <Typography
          color="primary"
          sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, minWidth: 0, overflowWrap: "break-word" }}
        >
          {rollerMapNotice}
        </Typography>
      </Stack>
    </Box>
  );
}

type LegendRowProps = {
  color: string;
  dashed?: boolean;
  label: string;
};

/**
 * Renders a compact route legend row inside the mock map.
 */
function LegendRow({ color, dashed = false, label }: LegendRowProps) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Box
        sx={{
          borderTop: dashed ? `2px dashed ${color}` : `4px solid ${color}`,
          borderRadius: 999,
          width: 28,
        }}
      />
      <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{label}</Typography>
    </Stack>
  );
}
