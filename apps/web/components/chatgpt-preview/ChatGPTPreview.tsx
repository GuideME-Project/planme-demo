import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import type { PlanmeItinerary } from "@planme/core";

type ChatGPTPreviewProps = {
  itinerary: PlanmeItinerary;
};

/**
 * Shows the expected Custom GPT response shape before users open PlanME.
 */
export function ChatGPTPreview({ itinerary }: ChatGPTPreviewProps) {
  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
            <Chip color="primary" icon={<AutoAwesomeRoundedIcon />} label="Custom GPT" />
            <Typography color="text.secondary" variant="body2">
              Actions 응답 예시
            </Typography>
          </Stack>

          <Typography variant="h2">
            GuideME 스타일의 여정으로 안내할께요.
          </Typography>

          <Typography color="text.secondary" sx={{ maxWidth: 800 }}>
            간단히 보면, 첫날은 인천공항 입국 후 부산 공연장으로 바로
            이동하고, 둘째 날은 해운대와 부산역 중심으로 정리하는 일정이
            좋아요. CarryME를 사용하면 호텔에 들르지 않고 바로 공연을
            시작할 수 있어요.
          </Typography>

          <Box
            sx={{
              alignItems: { xs: "flex-start", md: "center" },
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              gap: 2,
              justifyContent: "space-between",
              p: 2,
            }}
          >
            <Stack spacing={0.4}>
              <Typography variant="h3">{itinerary.title}</Typography>
              <Typography color="text.secondary">{itinerary.summary}</Typography>
              <Typography color="primary" variant="body2">
                {itinerary.detailUrl}
              </Typography>
            </Stack>
            <Button
              href={`/itinerary/${itinerary.id}`}
              size="large"
              startIcon={<LinkRoundedIcon />}
              variant="contained"
            >
              플랜미로 상세 일정 보기
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
