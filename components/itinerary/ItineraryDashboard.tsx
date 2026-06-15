import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import LuggageRoundedIcon from "@mui/icons-material/LuggageRounded";
import RouteRoundedIcon from "@mui/icons-material/RouteRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import type { PlanmeItinerary } from "@/lib/mock-data";
import { RouteMap } from "@/components/itinerary/RouteMap";
import { TimelinePanel } from "@/components/itinerary/TimelinePanel";

type ItineraryDashboardProps = {
  itinerary: PlanmeItinerary;
  compact: boolean;
};

/**
 * Renders the PlanME itinerary detail surface shown after the ChatGPT handoff.
 */
export function ItineraryDashboard({
  itinerary,
  compact,
}: ItineraryDashboardProps) {
  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
          <Grid container spacing={3} sx={{ alignItems: "stretch" }}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Stack spacing={2.2} sx={{ height: "100%" }}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: "wrap" }}
                  useFlexGap
                >
                  <Chip color="primary" label={itinerary.duration} />
                  <Chip color="secondary" label="CarryME 비교 포함" />
                  <Chip variant="outlined" label={itinerary.region} />
                </Stack>
                <Box>
                  <Typography variant="h1" sx={{ mb: 1 }}>
                    {itinerary.title}
                  </Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 17 }}>
                    {itinerary.summary}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ flexWrap: "wrap" }}
                  useFlexGap
                >
                  <Button startIcon={<RouteRoundedIcon />} variant="contained">
                    Day 1
                  </Button>
                  <Button variant="outlined">Day 2</Button>
                </Stack>
                <Divider />
                <Stack spacing={1.2}>
                  <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
                    <AccessTimeRoundedIcon color="primary" />
                    <Typography sx={{ fontWeight: 800 }}>
                      {itinerary.carrymeSaving}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
                    <LuggageRoundedIcon color="secondary" />
                    <Typography color="text.secondary">
                      수하물 배송을 전제로 호텔 경유 시간을 줄인 동선입니다.
                    </Typography>
                  </Stack>
                </Stack>
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <RouteMap />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <TimelinePanel stops={itinerary.stops} />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card variant="outlined" sx={{ height: "100%" }}>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack spacing={2}>
                <Typography variant="h2">동선 비교</Typography>
                {itinerary.comparisons.map((comparison) => (
                  <Box
                    key={comparison.label}
                    sx={{
                      border: "1px solid",
                      borderColor:
                        comparison.label === "CarryME" ? "secondary.main" : "divider",
                      borderRadius: 2,
                      p: 2,
                    }}
                  >
                    <Stack spacing={0.8}>
                      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                        <Typography sx={{ fontWeight: 850 }}>
                          {comparison.label}
                        </Typography>
                        {comparison.label === "CarryME" ? (
                          <Chip color="secondary" label="추천" size="small" />
                        ) : null}
                      </Stack>
                      <Typography>{comparison.duration}</Typography>
                      <Typography color="text.secondary">{comparison.luggage}</Typography>
                      <Typography color="text.secondary" variant="body2">
                        {comparison.highlight}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
                {!compact ? (
                  <Typography color="text.secondary" variant="body2">
                    이 화면은 Custom GPT Actions가 반환한 링크를 누른 뒤 PlanME 웹에서
                    확인하는 상세 화면 예시입니다.
                  </Typography>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
