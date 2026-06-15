"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import PhoneIphoneRoundedIcon from "@mui/icons-material/PhoneIphoneRounded";
import RouteRoundedIcon from "@mui/icons-material/RouteRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import WorkRoundedIcon from "@mui/icons-material/WorkRounded";
import {
  alpha,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import type { MouseEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import type {
  BenefitItem,
  PlanmeItinerary,
  RoutePlan,
  RoutePlanId,
  RouteStop,
} from "@/lib/mock-data";
import { RouteMap } from "@/components/itinerary/RouteMap";
import { TimelinePanel } from "@/components/itinerary/TimelinePanel";
import { usePlanmeColorMode } from "@/theme/ThemeRegistry";

type ItineraryDashboardProps = {
  itinerary: PlanmeItinerary;
  compact: boolean;
};

const stopIcons: Record<RouteStop["icon"], ReactNode> = {
  airport: <FlightTakeoffRoundedIcon />,
  hotel: <HotelRoundedIcon />,
  usj: <AttractionsRoundedIcon />,
};

const benefitIcons: Record<BenefitItem["icon"], ReactNode> = {
  shield: <ShieldRoundedIcon />,
  time: <AccessTimeRoundedIcon />,
  luggage: <WorkRoundedIcon />,
  phone: <PhoneIphoneRoundedIcon />,
};

/**
 * Renders the PlanME itinerary detail surface shown after the ChatGPT handoff.
 */
export function ItineraryDashboard({
  itinerary,
  compact,
}: ItineraryDashboardProps) {
  const theme = useTheme();
  const { mode, toggleMode } = usePlanmeColorMode();
  const [selectedDay, setSelectedDay] = useState(1);
  const [activeView, setActiveView] = useState<"compare" | "map">("compare");
  const [visibleRoutes, setVisibleRoutes] = useState<Record<RoutePlanId, boolean>>({
    standard: true,
    carryme: true,
  });
  const [copyLabel, setCopyLabel] = useState("일정 URL 복사");

  const isDark = mode === "dark";
  const selectedDayPlan = useMemo(
    () => itinerary.days.find((day) => day.day === selectedDay) ?? itinerary.days[0],
    [itinerary.days, selectedDay],
  );

  /**
   * Updates the selected itinerary day from the segmented control.
   */
  const handleDayChange = (
    _: MouseEvent<HTMLElement>,
    value: number | null,
  ) => {
    if (value) {
      setSelectedDay(value);
    }
  };

  /**
   * Updates the active dashboard view tab.
   */
  const handleViewChange = (
    _: MouseEvent<HTMLElement>,
    value: "compare" | "map" | null,
  ) => {
    if (value) {
      setActiveView(value);
    }
  };

  /**
   * Toggles a route overlay in the mock map.
   */
  const handleRouteToggle = (routeId: RoutePlanId) => {
    setVisibleRoutes((current) => ({
      ...current,
      [routeId]: !current[routeId],
    }));
  };

  /**
   * Copies the public itinerary URL for the demo handoff flow.
   */
  const handleCopyUrl = async () => {
    try {
      // Use the current browser origin when available so local demos copy a usable URL.
      const url =
        typeof window === "undefined"
          ? itinerary.detailUrl
          : `${window.location.origin}/itinerary/${itinerary.id}`;

      await navigator.clipboard.writeText(url);
      setCopyLabel("복사 완료");
      window.setTimeout(() => setCopyLabel("일정 URL 복사"), 1600);
    } catch {
      setCopyLabel("복사 실패");
      window.setTimeout(() => setCopyLabel("일정 URL 복사"), 1600);
    }
  };

  return (
    <Box
      sx={{
        color: "text.primary",
        mx: "auto",
        width: "100%",
      }}
    >
      <Stack spacing={3}>
        <TopBar
          copyLabel={copyLabel}
          mode={mode}
          onCopyUrl={handleCopyUrl}
          onToggleMode={toggleMode}
        />

        <Box
          sx={{
            alignItems: { xs: "flex-start", lg: "center" },
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", lg: "1fr auto" },
          }}
        >
          <Box>
            <Typography variant="h1">{itinerary.title}</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 18, mt: 1 }}>
              {itinerary.summary}
            </Typography>
          </Box>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ width: { xs: "100%", lg: "auto" } }}
          >
            <MetricCard
              icon={<AccessTimeRoundedIcon />}
              label="총 이동 시간(예상)"
              tone="primary"
              value={itinerary.totalDurationLabel}
            />
            <MetricCard
              icon={<WbSunnyRoundedIcon />}
              label="절약 시간(예상)"
              tone="error"
              value={itinerary.savedDurationLabel}
            />
          </Stack>
        </Box>

        <Box
          sx={{
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            boxShadow: isDark
              ? "0 20px 70px rgba(0,0,0,0.24)"
              : "0 18px 60px rgba(23, 32, 51, 0.08)",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                md: "1fr auto 1fr",
              },
              p: { xs: 1.5, md: 2 },
            }}
          >
            <ToggleButtonGroup
              exclusive
              color="primary"
              onChange={handleViewChange}
              value={activeView}
              sx={{ justifySelf: { xs: "stretch", md: "start" } }}
            >
              <ToggleButton value="compare">
                <RouteRoundedIcon sx={{ mr: 1 }} />
                동선 비교
              </ToggleButton>
              <ToggleButton value="map">
                <MapOutlinedIcon sx={{ mr: 1 }} />
                상세 지도
              </ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup
              exclusive
              color="primary"
              onChange={handleDayChange}
              value={selectedDay}
              sx={{ justifySelf: "center" }}
            >
              {itinerary.days.map((day) => (
                <ToggleButton key={day.day} value={day.day}>
                  {day.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                justifySelf: { xs: "stretch", md: "end" },
                px: 1.5,
                py: 1,
              }}
            >
              <RouteToggleButton
                active={visibleRoutes.standard}
                color={theme.palette.primary.main}
                label="Standard"
                onClick={() => handleRouteToggle("standard")}
              />
              <Divider flexItem orientation="vertical" />
              <RouteToggleButton
                active={visibleRoutes.carryme}
                color={theme.palette.secondary.main}
                label="CarryME"
                onClick={() => handleRouteToggle("carryme")}
              />
            </Stack>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 2fr) minmax(340px, 1fr)" },
              p: { xs: 1.5, md: 2 },
            }}
          >
            <Stack spacing={0}>
              <Box
                sx={{
                  display: activeView === "compare" ? "grid" : "none",
                  border: "1px solid",
                  borderBottom: 0,
                  borderColor: "divider",
                  borderRadius: "8px 8px 0 0",
                  gap: 0,
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  mb: 0,
                  overflow: "hidden",
                }}
              >
                <RouteComparisonCard
                  position="left"
                  route={selectedDayPlan.standard}
                  tone="primary"
                />
                <RouteComparisonCard
                  position="right"
                  route={selectedDayPlan.carryme}
                  savingLabel={itinerary.savedDurationLabel}
                  tone="secondary"
                />
              </Box>

              <RouteMap
                carrymeRoute={selectedDayPlan.carryme}
                showCarryme={visibleRoutes.carryme}
                showStandard={visibleRoutes.standard}
                standardRoute={selectedDayPlan.standard}
                attachedToComparison={activeView === "compare"}
                themeMode={mode}
              />
            </Stack>

            <TimelinePanel events={selectedDayPlan.timeline} mode={mode} />
          </Box>

        </Box>

        <BenefitStrip benefits={itinerary.benefits} />

        {!compact ? (
          <Typography color="text.secondary" variant="body2">
            이 화면은 Custom GPT Actions가 반환한 링크를 누른 뒤 PlanME 웹에서
            확인하는 상세 화면 예시입니다.
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

type TopBarProps = {
  copyLabel: string;
  mode: "light" | "dark";
  onCopyUrl: () => void;
  onToggleMode: () => void;
};

/**
 * Renders the compact PlanME header controls.
 */
function TopBar({ copyLabel, mode, onCopyUrl, onToggleMode }: TopBarProps) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: "center",
        gap: 2,
        justifyContent: "space-between",
      }}
    >
      <Stack direction="row" spacing={1.4} sx={{ alignItems: "center" }}>
        <RouteRoundedIcon color="primary" sx={{ fontSize: 38 }} />
        <Typography color="primary" sx={{ fontSize: 28, fontWeight: 900 }}>
          PlanME
        </Typography>
        <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
          by GuideME
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button onClick={onToggleMode} size="small" variant="outlined">
          테마 버전
          <Typography component="span" sx={{ ml: 0.8, fontSize: 12 }}>
            {mode === "dark" ? "Dark" : "Light"}
          </Typography>
        </Button>
        <Button
          color="inherit"
          size="small"
          startIcon={<HelpOutlineRoundedIcon />}
          variant="text"
        >
          이용 방법
        </Button>
        <Button
          onClick={onCopyUrl}
          startIcon={<ContentCopyRoundedIcon />}
          variant="contained"
        >
          {copyLabel}
        </Button>
      </Stack>
    </Stack>
  );
}

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  tone: "primary" | "error";
  value: string;
};

/**
 * Renders a top KPI card for travel duration and time saved.
 */
function MetricCard({ icon, label, tone, value }: MetricCardProps) {
  const theme = useTheme();
  const color =
    tone === "error" ? theme.palette.error.main : theme.palette.primary.main;

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        bgcolor: alpha(color, theme.palette.mode === "dark" ? 0.08 : 0.04),
        border: "1px solid",
        borderColor: alpha(color, 0.18),
        borderRadius: 2,
        minWidth: { sm: 260 },
        px: 2,
        py: 1.6,
      }}
    >
      <Box sx={{ color, display: "flex" }}>{icon}</Box>
      <Box>
        <Typography color={tone} sx={{ fontSize: 13, fontWeight: 800 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 18, fontWeight: 900 }}>{value}</Typography>
      </Box>
    </Stack>
  );
}

type RouteToggleButtonProps = {
  active: boolean;
  color: string;
  label: string;
  onClick: () => void;
};

/**
 * Renders a legend item that also toggles a route overlay.
 */
function RouteToggleButton({
  active,
  color,
  label,
  onClick,
}: RouteToggleButtonProps) {
  return (
    <Button
      color="inherit"
      onClick={onClick}
      size="small"
      sx={{ opacity: active ? 1 : 0.45 }}
    >
      <Box
        sx={{
          bgcolor: color,
          borderRadius: 999,
          height: 4,
          mr: 1,
          width: 24,
        }}
      />
      {label}
    </Button>
  );
}

type RouteComparisonCardProps = {
  position: "left" | "right";
  route: RoutePlan;
  savingLabel?: string;
  tone: "primary" | "secondary";
};

/**
 * Renders one Standard or CarryME route comparison summary.
 */
function RouteComparisonCard({
  position,
  route,
  savingLabel,
  tone,
}: RouteComparisonCardProps) {
  const theme = useTheme();
  const dividerColor =
    theme.palette.mode === "dark"
      ? alpha("#94a3b8", 0.18)
      : alpha("#172033", 0.1);

  return (
    <Box
      sx={{
        borderBottom: {
          xs: position === "left" ? `1px solid ${dividerColor}` : 0,
          md: 0,
        },
        borderRight: {
          xs: 0,
          md: position === "left" ? `1px solid ${dividerColor}` : 0,
        },
        p: { xs: 1.75, md: 2.5 },
      }}
    >
      <Stack spacing={1.7}>
        <Chip
          color={tone}
          label={route.badge}
          size="small"
          sx={{ alignSelf: "flex-start" }}
        />
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 900 }}>
            {route.routeText}
          </Typography>
          <Typography color={tone} sx={{ fontSize: 14, fontWeight: 800, mt: 0.5 }}>
            {route.description}
          </Typography>
        </Box>

        <Box
          sx={{
            display: "grid",
            gap: 1,
            gridTemplateColumns: "1fr auto 1fr auto 1fr",
            mb: 0.2,
          }}
        >
          {route.stops.map((stop, index) => (
            <RouteStopCell
              key={`${route.id}-${stop.label}`}
              showArrow={index < route.stops.length - 1}
              stop={stop}
            />
          ))}
        </Box>

        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            bgcolor: tone === "secondary" ? "rgba(34, 197, 94, 0.1)" : "rgba(37, 99, 235, 0.08)",
            borderRadius: 1.2,
            gap: 1,
            justifyContent: "center",
            minHeight: 46,
            px: 1.5,
            py: 1.05,
          }}
        >
          <AccessTimeRoundedIcon color={tone} fontSize="small" />
          <Typography
            color={tone}
            sx={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}
          >
            총 이동 시간(예상)
          </Typography>
          <Typography color={tone} sx={{ fontWeight: 900, whiteSpace: "nowrap" }}>
            {route.durationLabel}
          </Typography>
          {savingLabel ? (
            <Chip color="error" label={savingLabel} size="small" />
          ) : null}
        </Stack>
      </Stack>
    </Box>
  );
}

type RouteStopCellProps = {
  showArrow: boolean;
  stop: RouteStop;
};

/**
 * Renders one stop in a compact route summary.
 */
function RouteStopCell({ showArrow, stop }: RouteStopCellProps) {
  return (
    <>
      <Stack spacing={0.7} sx={{ alignItems: "center", minWidth: 0 }}>
        <Box
          sx={{
            alignItems: "center",
            bgcolor: "action.hover",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "999px",
            color: "text.primary",
            display: "flex",
            height: 48,
            justifyContent: "center",
            width: 48,
          }}
        >
          {stopIcons[stop.icon]}
        </Box>
        <Typography sx={{ fontSize: 13, fontWeight: 800, textAlign: "center" }}>
          {stop.label}
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12, textAlign: "center" }}>
          {stop.caption}
        </Typography>
      </Stack>
      {showArrow ? (
        <Typography
          color="text.secondary"
          sx={{ alignSelf: "center", fontSize: 28, fontWeight: 500 }}
        >
          →
        </Typography>
      ) : null}
    </>
  );
}

type BenefitStripProps = {
  benefits: BenefitItem[];
};

/**
 * Renders the bottom benefit strip from the selected UI concept.
 */
function BenefitStrip({ benefits }: BenefitStripProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        display: "grid",
        gap: 0,
        gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" },
        overflow: "hidden",
      }}
    >
      {benefits.map((benefit, index) => (
        <Stack
          key={benefit.title}
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            position: "relative",
            "&::before": {
              bgcolor:
                theme.palette.mode === "dark"
                  ? alpha("#94a3b8", 0.18)
                  : "#e5e7eb",
              content: '""',
              display: {
                xs: "none",
                md: index === 0 ? "none" : "block",
              },
              height: 44,
              left: 0,
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
              width: "1px",
            },
            p: 2,
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              bgcolor: alpha(
                index % 2 === 0 ? theme.palette.secondary.main : theme.palette.primary.main,
                0.14,
              ),
              borderRadius: "999px",
              color: index % 2 === 0 ? "secondary.main" : "primary.main",
              display: "flex",
              height: 46,
              justifyContent: "center",
              width: 46,
            }}
          >
            {benefitIcons[benefit.icon]}
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 900 }}>{benefit.title}</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {benefit.description}
            </Typography>
          </Box>
        </Stack>
      ))}
    </Box>
  );
}
