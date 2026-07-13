import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import RestaurantRoundedIcon from "@mui/icons-material/RestaurantRounded";
import TrainRoundedIcon from "@mui/icons-material/TrainRounded";
import WorkRoundedIcon from "@mui/icons-material/WorkRounded";
import { alpha, Box, Button, Chip, Stack, Typography, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import type { RouteStop, TimelineEvent } from "@planme/core";
import type { PlanmeThemeMode } from "@/theme/theme";
import {
  createCarrymeTimelineForWeb,
  createStandardTimelineForWeb,
  isCarrymeDeliveryEventForWeb,
} from "@/lib/itinerary-timeline-display";

type TimelinePanelProps = {
  carrymeDurationLabel: string;
  carrymeEvents: TimelineEvent[];
  carrymeStops: RouteStop[];
  isFinalDay: boolean;
  mode: PlanmeThemeMode;
  savingLabel?: string;
  standardDurationLabel: string;
  standardEvents: TimelineEvent[];
  standardStops: RouteStop[];
};

const categoryIcons: Record<TimelineEvent["category"], ReactNode> = {
  arrival: <FlightTakeoffRoundedIcon fontSize="small" />,
  carryme: <LocalShippingRoundedIcon fontSize="small" />,
  drive: <DirectionsCarRoundedIcon fontSize="small" />,
  transit: <TrainRoundedIcon fontSize="small" />,
  meal: <RestaurantRoundedIcon fontSize="small" />,
  hotel: <HotelRoundedIcon fontSize="small" />,
  event: <AttractionsRoundedIcon fontSize="small" />,
};

type RouteTimelineColumnProps = {
  durationLabel: string;
  durationTitle: string;
  events: TimelineEvent[];
  isFinalDay: boolean;
  isCarryme?: boolean;
  isDark: boolean;
  routeStops: RouteStop[];
  savingLabel?: string;
};

/**
 * Renders one route's confirmed timeline and duration summary.
 */
function RouteTimelineColumn({
  durationLabel,
  durationTitle,
  events,
  isFinalDay,
  isCarryme = false,
  isDark,
  routeStops,
  savingLabel,
}: RouteTimelineColumnProps) {
  const theme = useTheme();
  const tone = isCarryme ? "secondary" : "primary";
  const visibleEvents = isCarryme
    ? createCarrymeTimelineForWeb(events, { isFinalDay, stops: routeStops })
    : createStandardTimelineForWeb(events, { isFinalDay, stops: routeStops });

  return (
    <Stack
      data-testid={isCarryme ? "timeline-column-carryme" : "timeline-column-standard"}
      spacing={1.5}
      sx={{
        borderRight: { xs: 0, lg: isCarryme ? 0 : "1px solid" },
        borderColor: "divider",
        minWidth: 0,
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Typography color={tone} sx={{ fontSize: 16, fontWeight: 900 }}>
        {isCarryme ? "CarryME 일정" : "Standard 일정"}
      </Typography>

      <Stack spacing={0}>
        {visibleEvents.map((event, index) => {
          const isCarrymeDelivery =
            isCarryme && isCarrymeDeliveryEventForWeb(event);

          return (
            <Box
              key={`${event.time}-${event.title}-${index}`}
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
                  data-delivery-event={isCarrymeDelivery ? "true" : "false"}
                  data-event-category={event.category}
                  data-route-kind={isCarryme ? "carryme" : "standard"}
                  data-testid="timeline-event-icon"
                  sx={{
                    alignItems: "center",
                    bgcolor: isCarrymeDelivery
                      ? "primary.main"
                      : isDark
                        ? "#1f2937"
                        : "#344054",
                    border: "3px solid",
                    borderColor: isDark ? "#0f1720" : "#fff",
                    borderRadius: "999px",
                    boxShadow: isCarrymeDelivery
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
                  {isCarrymeDelivery
                    ? categoryIcons.carryme
                    : categoryIcons[event.category]}
                </Box>
                {index < visibleEvents.length - 1 ? (
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
                data-testid="timeline-event-content"
                sx={{
                  bgcolor: "transparent",
                  border: 0,
                  mb: 1.2,
                  ml: 1,
                  minWidth: 0,
                  px: 0,
                  py: 0.4,
                }}
              >
                <Typography sx={{ fontWeight: 900 }}>{event.title}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 14, mt: 0.2 }}>
                  {event.description}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Stack>

      <Box
        sx={{
          alignItems: "center",
          bgcolor: alpha(theme.palette[tone].main, isDark ? 0.12 : 0.08),
          border: "1px solid",
          borderColor: alpha(theme.palette[tone].main, 0.28),
          borderRadius: 1.5,
          display: "flex",
          gap: 1,
          justifyContent: "space-between",
          mt: "auto",
          px: 2,
          py: 1.4,
        }}
      >
        <Box>
          <Typography color={tone} sx={{ fontSize: 13, fontWeight: 800 }}>
            {durationTitle}
          </Typography>
          <Typography color={tone} sx={{ fontSize: 18, fontWeight: 900 }}>
            {durationLabel}
          </Typography>
        </Box>
        {isCarryme && savingLabel ? (
          <Chip
            color="error"
            data-testid="carryme-duration-saving-chip"
            label={savingLabel}
          />
        ) : null}
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
    </Stack>
  );
}

/**
 * Renders the selected day's confirmed Standard and CarryME timelines.
 */
export function TimelinePanel({
  carrymeDurationLabel,
  carrymeEvents,
  carrymeStops,
  isFinalDay,
  mode,
  savingLabel,
  standardDurationLabel,
  standardEvents,
  standardStops,
}: TimelinePanelProps) {
  const isDark = mode === "dark";

  return (
    <Box
      data-testid="timeline-panel"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* Keep both timelines visible so 4+ stops never depend on compact chip wrapping. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
        }}
      >
        <RouteTimelineColumn
          durationLabel={standardDurationLabel}
          durationTitle="Standard 총 이동 시간"
          events={standardEvents}
          isFinalDay={isFinalDay}
          isDark={isDark}
          routeStops={standardStops}
          savingLabel={savingLabel}
        />
        <RouteTimelineColumn
          durationLabel={carrymeDurationLabel}
          durationTitle="CarryME 총 이동 시간"
          events={carrymeEvents}
          isFinalDay={isFinalDay}
          isCarryme
          isDark={isDark}
          routeStops={carrymeStops}
          savingLabel={savingLabel}
        />
      </Box>
      <Typography color="text.secondary" sx={{ fontSize: 12, pb: 2, textAlign: "center" }}>
        * 실제 결제 기능은 포함되어 있지 않은 데모입니다.
      </Typography>
    </Box>
  );
}
