"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DirectionsBusRoundedIcon from "@mui/icons-material/DirectionsBusRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import DirectionsWalkRoundedIcon from "@mui/icons-material/DirectionsWalkRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
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
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import type { ChangeEvent, DragEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  BenefitItem,
  MapCoordinate,
  PlanmeItinerary,
  RoutePlan,
  RoutePlanId,
  RouteStop,
} from "@planme/core";
import { RouteMap } from "@/components/itinerary/RouteMap";
import { TimelinePanel } from "@/components/itinerary/TimelinePanel";
import { usePlanmeColorMode } from "@/theme/ThemeRegistry";

type ItineraryDashboardProps = {
  itinerary: PlanmeItinerary;
  compact: boolean;
};

type EditableDayPlan = Omit<PlanmeItinerary["days"][number], "day"> & {
  day: number;
  uiId: string;
};

type DestinationMode = "drive" | "transit" | "walk";

type DestinationRow = {
  coordinate?: MapCoordinate;
  id: string;
  mode: DestinationMode;
  name: string;
  placeId?: string;
};

type DestinationCandidate = {
  mainText: string;
  placeId: string;
  secondaryText: string;
  text: string;
};

type PlacesAutocompleteApiResponse = {
  candidates?: DestinationCandidate[];
  message?: string;
};

type PlaceDetailsApiResponse = {
  message?: string;
  place?: {
    coordinate: MapCoordinate;
    placeId: string;
    secondaryText: string;
    text: string;
  };
};

type RouteCheckApiResponse = {
  message?: string;
  ok: boolean;
  totalDistanceMeters?: number;
  totalDurationLabel?: string;
  warnings?: string[];
};

type AsyncStatus = "idle" | "loading" | "success" | "error";

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

const destinationModeOptions: Array<{
  icon: ReactNode;
  label: string;
  value: DestinationMode;
}> = [
  { icon: <DirectionsCarRoundedIcon fontSize="small" />, label: "자동차", value: "drive" },
  { icon: <DirectionsBusRoundedIcon fontSize="small" />, label: "대중교통", value: "transit" },
  { icon: <DirectionsWalkRoundedIcon fontSize="small" />, label: "도보", value: "walk" },
];

/**
 * Converts fixed itinerary days into local UI state that can add or remove days.
 */
function createEditableDays(days: PlanmeItinerary["days"]): EditableDayPlan[] {
  return days.map((day) => ({
    ...day,
    uiId: `seed-day-${day.day}`,
  }));
}

/**
 * Builds editable destination rows from the CarryME route because that is the target optimized path.
 */
function createDestinationRows(route: RoutePlan): DestinationRow[] {
  return route.stops.map((stop, index) => ({
    coordinate: stop.coordinate,
    id: `destination-${index}-${stop.label}`,
    mode: index === 0 ? "drive" : index === route.stops.length - 1 ? "walk" : "transit",
    name: stop.label,
  }));
}

/**
 * Returns the Korean role label for a route stop position.
 */
function getDestinationRole(index: number, total: number) {
  if (index === 0) {
    return "출발지";
  }

  if (index === total - 1) {
    return "도착지";
  }

  return "방문지";
}

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
  const [editableDays, setEditableDays] = useState<EditableDayPlan[]>(() =>
    createEditableDays(itinerary.days),
  );
  const [activeView, setActiveView] = useState<"compare" | "map">("compare");
  const [visibleRoutes, setVisibleRoutes] = useState<Record<RoutePlanId, boolean>>({
    standard: true,
    carryme: true,
  });
  const [copyLabel, setCopyLabel] = useState("일정 URL 복사");

  const isDark = mode === "dark";
  const selectedDayPlan = useMemo(
    () => editableDays.find((day) => day.day === selectedDay) ?? editableDays[0],
    [editableDays, selectedDay],
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
   * Adds a new local day tab by cloning the currently selected day structure.
   */
  const handleAddDay = () => {
    const templateDay = selectedDayPlan ?? editableDays[0];
    const nextDayNumber = editableDays.length + 1;

    if (!templateDay) {
      return;
    }

    // Clone the current demo day so the visual layout remains filled while data APIs are pending.
    setEditableDays((current) => [
      ...current,
      {
        ...templateDay,
        day: nextDayNumber,
        label: `Day ${nextDayNumber}`,
        uiId: `local-day-${Date.now()}-${nextDayNumber}`,
      },
    ]);
    setSelectedDay(nextDayNumber);
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

  if (!selectedDayPlan) {
    return null;
  }

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

            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: "center", justifySelf: "center" }}
            >
              <ToggleButtonGroup
                exclusive
                color="primary"
                onChange={handleDayChange}
                value={selectedDay}
              >
                {editableDays.map((day) => (
                  <ToggleButton
                    key={day.uiId}
                    value={day.day}
                    sx={{ minWidth: 112, position: "relative", px: 2.8 }}
                  >
                    {day.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Button
                aria-label="일자 추가"
                onClick={handleAddDay}
                size="small"
                sx={{ minWidth: 42, px: 1 }}
                variant="outlined"
              >
                <AddRoundedIcon fontSize="small" />
              </Button>
            </Stack>

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
              gridTemplateColumns: { xs: "1fr", md: "minmax(0, 2fr) minmax(300px, 0.95fr)" },
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

              <DestinationEditor
                key={selectedDayPlan.uiId}
                initialRows={createDestinationRows(selectedDayPlan.carryme)}
                mode={mode}
              />

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

type DestinationEditorProps = {
  initialRows: DestinationRow[];
  mode: "light" | "dark";
};

/**
 * Renders the local destination editor prototype between the comparison cards and map.
 */
function DestinationEditor({ initialRows, mode }: DestinationEditorProps) {
  const theme = useTheme();
  const [rows, setRows] = useState<DestinationRow[]>(initialRows);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DestinationCandidate[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState<AsyncStatus>("idle");
  const [suggestionMessage, setSuggestionMessage] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<AsyncStatus>("idle");
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [sessionToken] = useState(
    () => `planme-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const isDark = mode === "dark";

  const activeRow = rows.find((row) => row.id === activeRowId);

  useEffect(() => {
    if (!activeRow || activeRow.name.trim().length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setSuggestionStatus("loading");
      setSuggestionMessage(null);

      try {
        // Ask the server route for autocomplete so the browser does not own API contracts.
        const response = await fetch("/api/places/autocomplete", {
          body: JSON.stringify({
            input: activeRow.name,
            sessionToken,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PlacesAutocompleteApiResponse;

        if (!response.ok) {
          setSuggestions([]);
          setSuggestionStatus("error");
          setSuggestionMessage(payload.message ?? "장소 검색에 실패했습니다.");
          return;
        }

        setSuggestions(payload.candidates ?? []);
        setSuggestionStatus("success");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setSuggestions([]);
        setSuggestionStatus("error");
        setSuggestionMessage("장소 검색 요청을 완료하지 못했습니다.");
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeRow, sessionToken]);

  /**
   * Adds a waypoint before the final destination so start and end stay visually stable.
   */
  const handleAddWaypoint = () => {
    const newRow: DestinationRow = {
      id: `destination-local-${Date.now()}`,
      mode: "transit",
      name: "새 행선지",
    };

    // Insert before the last row because new stops are usually intermediate waypoints.
    setRows((current) => {
      if (current.length <= 1) {
        return [...current, newRow];
      }

      return [...current.slice(0, -1), newRow, current[current.length - 1]];
    });
    setActiveRowId(newRow.id);
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Deletes a destination row from the local editor.
   */
  const handleDeleteDestination = (rowId: string) => {
    if (rows.length <= 1) {
      return;
    }

    // Keep at least one row visible so the editing surface does not collapse.
    setRows((current) => current.filter((row) => row.id !== rowId));
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Updates the clicked destination text directly in the row.
   */
  const handleDestinationNameChange = (
    rowId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextName = event.target.value;

    // Clear the selected place because typing means the coordinate may no longer match.
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? { ...row, coordinate: undefined, name: nextName, placeId: undefined }
          : row,
      ),
    );
    setActiveRowId(rowId);
    if (nextName.trim().length < 2) {
      setSuggestions([]);
      setSuggestionStatus("idle");
      setSuggestionMessage(null);
    }
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Updates the local transport mode for a destination row.
   */
  const handleDestinationModeChange = (
    rowId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextMode = event.target.value as DestinationMode;

    // Store the selected mode locally until Google Routes integration is connected.
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, mode: nextMode } : row)),
    );
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Resolves an autocomplete result into a coordinate and stores it in the row.
   */
  const handleSelectCandidate = async (
    rowId: string,
    candidate: DestinationCandidate,
  ) => {
    setSuggestionStatus("loading");
    setSuggestionMessage(null);

    try {
      // Details lookup finalizes the coordinate used by route checks.
      const response = await fetch("/api/places/details", {
        body: JSON.stringify({
          placeId: candidate.placeId,
          sessionToken,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as PlaceDetailsApiResponse;

      if (!response.ok || !payload.place) {
        setSuggestionStatus("error");
        setSuggestionMessage(payload.message ?? "장소 좌표를 확인하지 못했습니다.");
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? {
                ...row,
                coordinate: payload.place?.coordinate,
                name: payload.place?.text ?? candidate.mainText,
                placeId: payload.place?.placeId,
              }
            : row,
        ),
      );
      setActiveRowId(null);
      setSuggestions([]);
      setSuggestionStatus("idle");
      setRouteStatus("idle");
      setRouteMessage(null);
    } catch {
      setSuggestionStatus("error");
      setSuggestionMessage("장소 상세 조회 요청을 완료하지 못했습니다.");
    }
  };

  /**
   * Checks the current destination order and travel modes through Google Routes.
   */
  const handleCheckRoute = async () => {
    setRouteStatus("loading");
    setRouteMessage("경로를 확인하는 중입니다.");

    try {
      // The server route computes adjacent segments to support mixed row modes.
      const response = await fetch("/api/routes/check", {
        body: JSON.stringify({ stops: rows }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as RouteCheckApiResponse;

      if (!response.ok || !payload.ok) {
        setRouteStatus("error");
        setRouteMessage(payload.message ?? "경로 체크에 실패했습니다.");
        return;
      }

      const distanceKm =
        typeof payload.totalDistanceMeters === "number"
          ? ` · 약 ${(payload.totalDistanceMeters / 1000).toFixed(1)}km`
          : "";

      setRouteStatus("success");
      setRouteMessage(
        `경로 체크 완료 · ${payload.totalDurationLabel ?? "시간 확인 완료"}${distanceKm}${
          payload.warnings?.length ? " · 일부 구간 확인 필요" : ""
        }`,
      );
    } catch {
      setRouteStatus("error");
      setRouteMessage("경로 체크 요청을 완료하지 못했습니다.");
    }
  };

  /**
   * Allows the row to receive a dragged destination.
   */
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  /**
   * Moves the dragged destination row above the row it was dropped on.
   */
  const handleDropDestination = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }

    // Reorder by removing the dragged row and inserting it at the drop target index.
    setRows((current) => {
      const draggedRow = current.find((row) => row.id === draggingId);
      const targetIndex = current.findIndex((row) => row.id === targetId);

      if (!draggedRow || targetIndex < 0) {
        return current;
      }

      const withoutDragged = current.filter((row) => row.id !== draggingId);
      const nextTargetIndex = withoutDragged.findIndex((row) => row.id === targetId);

      return [
        ...withoutDragged.slice(0, nextTargetIndex),
        draggedRow,
        ...withoutDragged.slice(nextTargetIndex),
      ];
    });
    setDraggingId(null);
  };

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        borderLeft: "1px solid",
        borderRight: "1px solid",
        borderBottom: 0,
        borderTop: "1px solid",
        borderColor: "divider",
        borderTopColor: isDark ? alpha("#94a3b8", 0.18) : "#e5e7eb",
        px: { xs: 1.25, md: 1.5 },
        py: 1,
      }}
    >
      <Stack spacing={0.8}>
        <Stack
          spacing={1}
          sx={{
            alignItems: { xs: "stretch", sm: "center" },
            columnGap: 0.75,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "28px 32px minmax(0, 1fr) 92px 136px",
            },
            px: 0.75,
            rowGap: 1,
          }}
        >
          <Stack
            direction="row"
            spacing={1.4}
            sx={{
              alignItems: "baseline",
              gridColumn: { xs: "1", md: "1 / 4" },
              minWidth: 0,
            }}
          >
            <Typography sx={{ fontSize: 15, fontWeight: 900 }}>
              행선지 편집
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              gridColumn: { xs: "1", md: "4 / 6" },
              justifyContent: "flex-end",
            }}
          >
            <Button
              onClick={handleAddWaypoint}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={{ minHeight: 34 }}
              variant="outlined"
            >
              경유지 추가
            </Button>
            <Button
              disabled={routeStatus === "loading" || rows.length < 2}
              onClick={handleCheckRoute}
              size="small"
              startIcon={<RouteRoundedIcon />}
              sx={{ minHeight: 34 }}
              variant="contained"
            >
              {routeStatus === "loading" ? "계산 중" : "경로 다시 계산"}
            </Button>
          </Stack>
        </Stack>

        {routeMessage ? (
          <Box
            sx={{
              bgcolor:
                routeStatus === "error"
                  ? alpha(theme.palette.error.main, 0.06)
                  : alpha(theme.palette.secondary.main, 0.08),
              border: "1px solid",
              borderColor:
                routeStatus === "error"
                  ? alpha(theme.palette.error.main, 0.26)
                  : alpha(theme.palette.secondary.main, 0.2),
              borderRadius: 1.2,
              color: routeStatus === "error" ? "error.main" : "secondary.main",
              fontSize: 13,
              fontWeight: 800,
              px: 1.5,
              py: 0.8,
            }}
          >
            {routeMessage}
          </Box>
        ) : null}

        <Stack spacing={0.75}>
          {rows.map((row, index) => (
            <Box
              key={row.id}
              draggable
              onDragEnd={() => setDraggingId(null)}
              onDragOver={handleDragOver}
              onDragStart={() => setDraggingId(row.id)}
              onDrop={() => handleDropDestination(row.id)}
              sx={{
                alignItems: "center",
                bgcolor:
                  draggingId === row.id
                    ? alpha(theme.palette.primary.main, 0.08)
                    : isDark
                      ? alpha("#1f2937", 0.68)
                      : alpha("#f8fafc", 0.9),
                border: "1px solid",
                borderColor:
                  draggingId === row.id
                    ? alpha(theme.palette.primary.main, 0.45)
                    : "divider",
                borderRadius: 1.2,
                display: "grid",
                gap: 0.75,
                gridTemplateColumns: {
                  xs: "28px 32px minmax(0, 1fr)",
                  md: "28px 32px minmax(0, 1fr) 92px 136px",
                },
                minHeight: 40,
                px: 0.75,
                py: 0.45,
              }}
            >
              <Box
                sx={{
                  alignItems: "center",
                  color: "text.secondary",
                  cursor: "grab",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <DragIndicatorRoundedIcon fontSize="small" />
              </Box>
              <Box
                sx={{
                  alignItems: "center",
                  border: "1px solid",
                  borderColor: "primary.main",
                  borderRadius: "999px",
                  color: "primary.main",
                  display: "flex",
                  fontSize: 13,
                  fontWeight: 900,
                  height: 26,
                  justifyContent: "center",
                  width: 26,
                }}
              >
                {index + 1}
              </Box>
              <Box
                sx={{
                  alignItems: "center",
                  bgcolor: "transparent",
                  border: 0,
                  borderRadius: 1,
                  display: "grid",
                  gap: 0.75,
                  gridTemplateColumns: "20px auto auto minmax(0, 1fr)",
                  height: 34,
                  minWidth: 0,
                  position: "relative",
                  px: 0.5,
                  "&:hover": {
                    bgcolor: isDark
                      ? alpha("#94a3b8", 0.08)
                      : alpha(theme.palette.primary.main, 0.04),
                  },
                }}
              >
                <LocationOnOutlinedIcon color="action" fontSize="small" />
                <Box
                  aria-label={`${getDestinationRole(index, rows.length)} 행선지`}
                  component="input"
                  onChange={(event) => handleDestinationNameChange(row.id, event)}
                  onFocus={() => setActiveRowId(row.id)}
                  value={row.name}
                  sx={{
                    bgcolor: "transparent",
                    border: 0,
                    color: "text.primary",
                    font: "inherit",
                    fontSize: 14,
                    fontWeight: 900,
                    minWidth: 0,
                    outline: 0,
                    p: 0,
                    width: `${Math.max(row.name.length + 1, 4)}em`,
                  }}
                />
                <Typography
                  color="text.secondary"
                  sx={{ fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}
                >
                  {getDestinationRole(index, rows.length)}
                </Typography>
                {activeRowId === row.id &&
                (suggestionStatus === "loading" ||
                  suggestionStatus === "error" ||
                  suggestions.length > 0) ? (
                  <Box
                    sx={{
                      bgcolor: "background.paper",
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1.3,
                      boxShadow: isDark
                        ? "0 18px 36px rgba(0,0,0,0.38)"
                        : "0 18px 36px rgba(15,23,42,0.14)",
                      left: 0,
                      maxHeight: 220,
                      minWidth: { xs: 260, md: 380 },
                      overflowY: "auto",
                      position: "absolute",
                      top: 38,
                      width: "max-content",
                      zIndex: 20,
                    }}
                  >
                    {suggestionStatus === "loading" ? (
                      <Typography color="text.secondary" sx={{ fontSize: 13, p: 1.2 }}>
                        장소를 검색하는 중입니다.
                      </Typography>
                    ) : null}
                    {suggestionStatus === "error" ? (
                      <Typography color="error" sx={{ fontSize: 13, p: 1.2 }}>
                        {suggestionMessage ?? "장소 검색에 실패했습니다."}
                      </Typography>
                    ) : null}
                    {suggestionStatus !== "loading"
                      ? suggestions.map((candidate) => (
                          <Box
                            key={candidate.placeId}
                            component="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSelectCandidate(row.id, candidate)}
                            sx={{
                              bgcolor: "transparent",
                              border: 0,
                              borderBottom: "1px solid",
                              borderColor: "divider",
                              color: "text.primary",
                              cursor: "pointer",
                              display: "block",
                              font: "inherit",
                              px: 1.2,
                              py: 1,
                              textAlign: "left",
                              width: "100%",
                              "&:hover": {
                                bgcolor: alpha(theme.palette.primary.main, 0.06),
                              },
                              "&:last-of-type": {
                                borderBottom: 0,
                              },
                            }}
                          >
                            <Typography sx={{ fontSize: 13.5, fontWeight: 900 }}>
                              {candidate.mainText || candidate.text}
                            </Typography>
                            {candidate.secondaryText ? (
                              <Typography
                                color="text.secondary"
                                sx={{ fontSize: 12, mt: 0.2 }}
                              >
                                {candidate.secondaryText}
                              </Typography>
                            ) : null}
                          </Box>
                        ))
                      : null}
                    {suggestionStatus === "success" && suggestions.length === 0 ? (
                      <Typography color="text.secondary" sx={{ fontSize: 13, p: 1.2 }}>
                        검색 결과가 없습니다.
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
              <Button
                color="error"
                disabled={rows.length <= 1}
                onClick={() => handleDeleteDestination(row.id)}
                size="small"
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                sx={{
                  display: { xs: "none", md: "inline-flex" },
                  height: 34,
                  minWidth: 92,
                  px: 1,
                }}
                variant="outlined"
              >
                삭제
              </Button>
              <TextField
                select
                hiddenLabel
                onChange={(event) => handleDestinationModeChange(row.id, event)}
                size="small"
                value={row.mode}
                sx={{
                  display: { xs: "none", md: "block" },
                  "& .MuiInputBase-root": {
                    bgcolor: "background.paper",
                    borderRadius: 1,
                    fontSize: 13,
                    height: 34,
                    width: 136,
                  },
                  "& .MuiSelect-select": {
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "center",
                    minWidth: 96,
                    py: 0,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  },
                  "& .MuiSelect-select .MuiStack-root": {
                    justifyContent: "center",
                    width: "100%",
                  },
                }}
              >
                {destinationModeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      {option.icon}
                      <span>{option.label}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          ))}
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
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 800,
            textAlign: "center",
            whiteSpace: { md: "nowrap" },
          }}
        >
          {stop.label}
        </Typography>
        <Typography
          color="text.secondary"
          sx={{
            fontSize: 12,
            textAlign: "center",
            whiteSpace: { md: "nowrap" },
          }}
        >
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
