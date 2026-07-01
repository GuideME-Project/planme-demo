import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import RestaurantRoundedIcon from "@mui/icons-material/RestaurantRounded";
import TrainRoundedIcon from "@mui/icons-material/TrainRounded";
import WorkRoundedIcon from "@mui/icons-material/WorkRounded";
import { alpha, Box, Button, Chip, Stack, Typography, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";
import type { TimelineEvent } from "@planme/core";
import type { PlanmeThemeMode } from "@/theme/theme";

type TimelineView = "standard" | "carryme";

type TimelinePanelProps = {
  carrymeDurationLabel: string;
  carrymeEvents: TimelineEvent[];
  mode: PlanmeThemeMode;
  savingLabel: string;
  standardDurationLabel: string;
  standardEvents: TimelineEvent[];
};

const categoryIcons: Record<TimelineEvent["category"], ReactNode> = {
  arrival: <FlightTakeoffRoundedIcon fontSize="small" />,
  carryme: <LocalShippingRoundedIcon fontSize="small" />,
  transit: <TrainRoundedIcon fontSize="small" />,
  meal: <RestaurantRoundedIcon fontSize="small" />,
  hotel: <HotelRoundedIcon fontSize="small" />,
  event: <AttractionsRoundedIcon fontSize="small" />,
};

/**
 * Renders the selected day's confirmed Standard or CarryME timeline.
 */
export function TimelinePanel({
  carrymeDurationLabel,
  carrymeEvents,
  mode,
  savingLabel,
  standardDurationLabel,
  standardEvents,
}: TimelinePanelProps) {
  const theme = useTheme();
  const isDark = mode === "dark";
  const [activeTimeline, setActiveTimeline] = useState<TimelineView>("carryme");
  const isCarryme = activeTimeline === "carryme";
  const events = isCarryme ? carrymeEvents : standardEvents;
  const durationLabel = isCarryme ? carrymeDurationLabel : standardDurationLabel;
  const durationTitle = isCarryme
    ? "CarryME 총 이동 시간(예상)"
    : "Standard 총 이동 시간(예상)";

  return (
    <Box
      data-testid="timeline-panel"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <Button
          onClick={() => setActiveTimeline("standard")}
          variant={activeTimeline === "standard" ? "outlined" : "text"}
          sx={{
            borderColor: "primary.main",
            borderRadius: 0,
            borderWidth: activeTimeline === "standard" ? "0 0 3px" : 0,
            color: "primary.main",
            minHeight: 46,
          }}
        >
          Standard 일정
        </Button>
        <Button
          color="secondary"
          onClick={() => setActiveTimeline("carryme")}
          variant={activeTimeline === "carryme" ? "outlined" : "text"}
          sx={{
            borderColor: "secondary.main",
            borderRadius: 0,
            borderWidth: activeTimeline === "carryme" ? "0 0 3px" : 0,
            minHeight: 46,
          }}
        >
          CarryME 일정
        </Button>
      </Stack>

      <Stack spacing={0} sx={{ p: { xs: 2, md: 2.5 } }}>
        {events.map((event, index) => (
          <Box
            key={`${event.time}-${event.title}`}
            sx={{
              display: "grid",
              gridTemplateColumns: "58px 40px 1fr",
              minHeight: 86,
            }}
          >
            <Typography
              color="text.secondary"
              sx={{ fontSize: 14, fontWeight: 800, pt: 0.7 }}
            >
              {event.time}
            </Typography>
            <Stack sx={{ alignItems: "center", position: "relative" }}>
              <Box
                sx={{
                  alignItems: "center",
                  bgcolor:
                    event.category === "carryme"
                      ? "primary.main"
                      : isDark
                        ? "#1f2937"
                        : "#344054",
                  border: "3px solid",
                  borderColor: isDark ? "#0f1720" : "#fff",
                  borderRadius: "999px",
                  boxShadow: event.highlight
                    ? `0 0 28px ${alpha(theme.palette.primary.main, 0.72)}`
                    : "0 8px 20px rgba(15, 23, 42, 0.16)",
                  color: "#fff",
                  display: "flex",
                  height: 38,
                  justifyContent: "center",
                  width: 38,
                  zIndex: 1,
                }}
              >
                {categoryIcons[event.category]}
              </Box>
              {index < events.length - 1 ? (
                <Box
                  sx={{
                    bgcolor: "secondary.main",
                    bottom: 0,
                    opacity: 0.9,
                    position: "absolute",
                    top: 38,
                    width: 2,
                  }}
                />
              ) : null}
            </Stack>
            <Box
              sx={{
                bgcolor: event.highlight
                  ? alpha(theme.palette.secondary.main, isDark ? 0.12 : 0.1)
                  : "transparent",
                border: event.highlight ? "1px solid" : 0,
                borderColor: alpha(theme.palette.secondary.main, 0.22),
                borderRadius: 1.5,
                mb: 1.2,
                ml: 1,
                px: event.highlight ? 1.5 : 0,
                py: event.highlight ? 1.2 : 0.4,
              }}
            >
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>{event.title}</Typography>
                {event.savingLabel ? (
                  <Chip
                    color="error"
                    label={savingLabel}
                    size="small"
                    sx={{ height: 24 }}
                  />
                ) : null}
                {event.highlight ? (
                  <Box
                    sx={{
                      alignItems: "center",
                      bgcolor: "secondary.main",
                      borderRadius: "999px",
                      color: "#fff",
                      display: "flex",
                      height: 24,
                      justifyContent: "center",
                      ml: "auto",
                      width: 24,
                    }}
                  >
                    <CheckRoundedIcon sx={{ fontSize: 17 }} />
                  </Box>
                ) : null}
              </Stack>
              <Typography color="text.secondary" sx={{ fontSize: 14, mt: 0.2 }}>
                {event.description}
              </Typography>
            </Box>
          </Box>
        ))}

        <Stack spacing={1.2} sx={{ mt: 1 }}>
          <Box
            sx={{
              alignItems: "center",
              bgcolor: alpha(theme.palette.secondary.main, isDark ? 0.12 : 0.08),
              border: "1px solid",
              borderColor: alpha(theme.palette.secondary.main, 0.28),
              borderRadius: 1.5,
              display: "flex",
              justifyContent: "space-between",
              px: 2,
              py: 1.4,
            }}
          >
            <Box>
              <Typography color="secondary" sx={{ fontSize: 13, fontWeight: 800 }}>
                {durationTitle}
              </Typography>
              <Typography color="secondary" sx={{ fontSize: 18, fontWeight: 900 }}>
                {durationLabel}
              </Typography>
            </Box>
            {isCarryme ? <Chip color="error" label={savingLabel} /> : null}
          </Box>
          {isCarryme ? (
            <Button
              color="secondary"
              fullWidth
              size="large"
              startIcon={<WorkRoundedIcon />}
              variant="contained"
            >
              CarryME로 짐 맡기기 (데모)
            </Button>
          ) : null}
          <Typography color="text.secondary" sx={{ fontSize: 12, textAlign: "center" }}>
            * 실제 결제 기능은 포함되어 있지 않은 데모입니다.
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
