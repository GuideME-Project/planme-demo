import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import { Box, Chip, Stack, Typography } from "@mui/material";

/**
 * Renders a lightweight map-style visual for the Osaka demo route.
 */
export function RouteMap() {
  const points = [
    { label: "KIX", left: "14%", top: "76%", icon: <FlightTakeoffRoundedIcon /> },
    { label: "USJ", left: "54%", top: "42%", icon: <LocationOnRoundedIcon /> },
    { label: "Hotel", left: "78%", top: "28%", icon: <HotelRoundedIcon /> },
  ];

  return (
    <Box
      sx={{
        background:
          "linear-gradient(135deg, #eaf3ff 0%, #f7fbff 48%, #eef7ec 100%)",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        minHeight: { xs: 320, md: 430 },
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Box
        sx={{
          backgroundImage:
            "linear-gradient(rgba(37, 99, 235, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235, 0.08) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          inset: 0,
          position: "absolute",
        }}
      />
      <Box
        sx={{
          border: "6px solid rgba(34, 197, 94, 0.65)",
          borderLeft: 0,
          borderTop: 0,
          height: "42%",
          left: "19%",
          position: "absolute",
          top: "43%",
          transform: "skewY(-18deg)",
          width: "40%",
        }}
      />
      <Box
        sx={{
          borderTop: "6px dashed rgba(91, 102, 122, 0.5)",
          left: "56%",
          position: "absolute",
          top: "37%",
          transform: "rotate(-16deg)",
          width: "25%",
        }}
      />
      {points.map((point) => (
        <Stack
          key={point.label}
          spacing={0.5}
          sx={{
            alignItems: "center",
            left: point.left,
            position: "absolute",
            top: point.top,
            transform: "translate(-50%, -50%)",
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              bgcolor: "primary.main",
              border: "4px solid #fff",
              borderRadius: "999px",
              boxShadow: "0 8px 24px rgba(37, 99, 235, 0.28)",
              color: "#fff",
              display: "flex",
              height: 52,
              justifyContent: "center",
              width: 52,
            }}
          >
            {point.icon}
          </Box>
          <Chip label={point.label} size="small" />
        </Stack>
      ))}
      <Box sx={{ bottom: 18, left: 18, position: "absolute", right: 18 }}>
        <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
          CarryME 동선은 호텔 경유 없이 공항에서 USJ로 바로 이어지는 흐름을 기준으로
          비교합니다.
        </Typography>
      </Box>
    </Box>
  );
}
