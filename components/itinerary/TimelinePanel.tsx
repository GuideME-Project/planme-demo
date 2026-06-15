import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import LuggageRoundedIcon from "@mui/icons-material/LuggageRounded";
import RestaurantRoundedIcon from "@mui/icons-material/RestaurantRounded";
import TrainRoundedIcon from "@mui/icons-material/TrainRounded";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { ItineraryStop } from "@/lib/mock-data";

type TimelinePanelProps = {
  stops: ItineraryStop[];
};

const categoryIcons: Record<ItineraryStop["category"], React.ReactNode> = {
  arrival: <CheckCircleRoundedIcon />,
  carryme: <LuggageRoundedIcon />,
  transit: <TrainRoundedIcon />,
  attraction: <CheckCircleRoundedIcon />,
  meal: <RestaurantRoundedIcon />,
};

/**
 * Renders the primary day timeline for the itinerary.
 */
export function TimelinePanel({ stops }: TimelinePanelProps) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={2.2}>
          <Typography variant="h2">Day 1 타임라인</Typography>
          <Stack spacing={0}>
            {stops.map((stop, index) => (
              <Box
                key={`${stop.time}-${stop.title}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "64px 36px 1fr",
                  minHeight: 82,
                }}
              >
                <Typography sx={{ fontWeight: 800, pt: 0.6 }}>
                  {stop.time}
                </Typography>
                <Stack sx={{ alignItems: "center", position: "relative" }}>
                  <Box
                    sx={{
                      alignItems: "center",
                      bgcolor: stop.category === "carryme" ? "secondary.main" : "primary.main",
                      borderRadius: "999px",
                      color: "#fff",
                      display: "flex",
                      height: 34,
                      justifyContent: "center",
                      width: 34,
                      zIndex: 1,
                    }}
                  >
                    {categoryIcons[stop.category]}
                  </Box>
                  {index < stops.length - 1 ? (
                    <Box
                      sx={{
                        bgcolor: "divider",
                        bottom: 0,
                        position: "absolute",
                        top: 34,
                        width: 2,
                      }}
                    />
                  ) : null}
                </Stack>
                <Box sx={{ pb: 2.2, pl: 1.2 }}>
                  <Typography sx={{ fontWeight: 850 }}>{stop.title}</Typography>
                  <Typography color="text.secondary">{stop.description}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
