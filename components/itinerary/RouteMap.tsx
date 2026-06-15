import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import { alpha, Box, Stack, Typography, useTheme } from "@mui/material";
import type { MapPoint, RoutePlan } from "@/lib/mock-data";
import type { PlanmeThemeMode } from "@/theme/theme";

type RouteMapProps = {
  attachedToComparison?: boolean;
  standardRoute: RoutePlan;
  carrymeRoute: RoutePlan;
  showStandard: boolean;
  showCarryme: boolean;
  themeMode: PlanmeThemeMode;
};

const mapMarkers = [
  {
    id: "kix",
    label: "간사이 국제공항 (KIX)",
    icon: <FlightTakeoffRoundedIcon fontSize="small" />,
    x: 8,
    y: 73,
    tone: "primary",
  },
  {
    id: "hotel",
    label: "호텔 체크인",
    caption: "수하물 보관",
    icon: <HotelRoundedIcon fontSize="small" />,
    x: 36,
    y: 54,
    tone: "primary",
  },
  {
    id: "usj",
    label: "유니버설 스튜디오 재팬 (USJ)",
    icon: <AttractionsRoundedIcon fontSize="small" />,
    x: 74,
    y: 32,
    tone: "secondary",
  },
  {
    id: "carryme",
    label: "캐리미 짐 탁송",
    caption: "공항에서 호텔로 배송",
    icon: <LocalShippingRoundedIcon fontSize="small" />,
    x: 57,
    y: 66,
    tone: "secondary",
  },
] as const;

/**
 * Converts percentage coordinates into an SVG polyline point string.
 */
function toPointString(points: MapPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * Renders a Google Maps-like mock route view with replaceable route props.
 */
export function RouteMap({
  attachedToComparison = false,
  standardRoute,
  carrymeRoute,
  showStandard,
  showCarryme,
  themeMode,
}: RouteMapProps) {
  const theme = useTheme();
  const isDark = themeMode === "dark";
  const standardColor = theme.palette.primary.main;
  const carrymeColor = theme.palette.secondary.main;
  const mapBackground = isDark
    ? "linear-gradient(135deg, #111827 0%, #17212d 48%, #0e2530 100%)"
    : "linear-gradient(135deg, #dceeff 0%, #f6fbff 48%, #e9f8ec 100%)";

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
        sx={{
          background: mapBackground,
          minHeight: { xs: 320, md: 360 },
          overflow: "hidden",
          position: "relative",
        }}
      >
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
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.45"
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
            strokeWidth="1.45"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {showCarryme && carrymeRoute.dashedPath ? (
          <polyline
            fill="none"
            points={toPointString(carrymeRoute.dashedPath)}
            stroke={carrymeColor}
            strokeDasharray="2 2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1"
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
        <LegendRow dashed color={carrymeColor} label="짐 탁송 경로" />
      </Stack>
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
        }}
      >
        <InfoRoundedIcon color="primary" fontSize="small" />
        <Typography color="primary" sx={{ fontSize: 13, fontWeight: 700 }}>
          CarryME 이용 시 호텔 경유가 없어 약 2시간을 절약할 수 있습니다.
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
