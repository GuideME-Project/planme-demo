"use client";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import ConfirmationNumberRoundedIcon from "@mui/icons-material/ConfirmationNumberRounded";
import SimCardRoundedIcon from "@mui/icons-material/SimCardRounded";
import CurrencyExchangeRoundedIcon from "@mui/icons-material/CurrencyExchangeRounded";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import { Box, Button, Stack, Typography } from "@mui/material";
import { useEffect, useRef } from "react";
import type { PlanmePlaceAttribution } from "@/lib/planme-places";

const PREPARATION_CARDS = [
  { title: "항공", caption: "여행의 시작", description: "출발 시간과 수하물 조건을 살펴보세요.", Icon: FlightTakeoffRoundedIcon, color: "#2364d8", background: "#eaf2ff" },
  { title: "숙박", caption: "편안한 머무름", description: "여행 동선에 맞는 숙소 위치를 생각해 보세요.", Icon: HotelRoundedIcon, color: "#7c50bc", background: "#f2edfc" },
  { title: "체험 · 티켓", caption: "기억에 남을 순간", description: "꼭 해보고 싶은 체험과 방문지를 골라보세요.", Icon: ConfirmationNumberRoundedIcon, color: "#b55e27", background: "#fff2e6" },
  { title: "eSIM", caption: "도착하자마자 연결", description: "사용할 데이터와 휴대폰 호환 여부를 확인해 보세요.", Icon: SimCardRoundedIcon, color: "#187b77", background: "#e7f6f3" },
  { title: "환전", caption: "현지에서 가볍게", description: "현지 통화와 결제 수단을 미리 확인해 보세요.", Icon: CurrencyExchangeRoundedIcon, color: "#927016", background: "#fcf5dd" },
  { title: "여행자 보험", caption: "마음까지 든든하게", description: "여행 기간과 필요한 보장 내용을 살펴보세요.", Icon: VerifiedUserOutlinedIcon, color: "#587086", background: "#edf2f7" },
];

type PlanmeGlobalPreparationProps = {
  origin: string;
  internationalSide: "origin" | "destination";
  destination: string;
  countryName: string;
  attributions?: PlanmePlaceAttribution[];
  onSearchAgain: () => void;
};

export function PlanmeGlobalPreparation({ origin, destination, attributions = [], onSearchAgain }: PlanmeGlobalPreparationProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return (
    <Box sx={{ maxWidth: 1120, mx: "auto", px: { xs: 2.5, sm: 4 }, pt: { xs: 2.5, md: 4 }, pb: { xs: 5, md: 7 } }}>
      <Button onClick={onSearchAgain} startIcon={<ArrowBackRoundedIcon />} sx={{ px: 0.5, mb: 3, color: "#53657d", fontWeight: 650 }}>
        다른 여행지 검색
      </Button>

      <Box component="section" aria-labelledby="global-preparation-heading" sx={{ p: { xs: 2.5, sm: 4, md: 5 }, borderRadius: 4, border: "1px solid #dce5f1", borderTop: "4px solid #326bd6", bgcolor: "#fff", boxShadow: "0 8px 30px rgba(35,65,109,0.04)" }}>
        <Stack direction="row" sx={{ gap: { xs: 1.5, sm: 2 }, alignItems: "flex-start", mb: { xs: 3, sm: 3.5 } }}>
          <Box sx={{ flexShrink: 0, width: { xs: 40, sm: 52 }, height: { xs: 40, sm: 52 }, mt: 0.5, borderRadius: 2, bgcolor: "#eaf1ff", color: "#326bd6", display: "grid", placeItems: "center" }}>
            <FlightTakeoffRoundedIcon aria-hidden="true" sx={{ fontSize: { xs: 25, sm: 30 } }} />
          </Box>
          <Typography id="global-preparation-heading" component="h1" ref={headingRef} tabIndex={-1} sx={{ minWidth: 0, color: "#172f51", fontSize: { xs: 32, sm: 40, md: 44 }, lineHeight: 1.3, fontWeight: 800, letterSpacing: "-0.04em", wordBreak: "keep-all", overflowWrap: "anywhere", "&:focus-visible": { outline: "2px solid #1660df", outlineOffset: 6 } }}>
            이 여행은 준비 중이에요
          </Typography>
        </Stack>
        <Box aria-label={`출발 ${origin}, 목적지 ${destination}`} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: { xs: 1.25, sm: 3 }, px: { xs: 2, sm: 3 }, py: { xs: 2.5, sm: 3 }, borderRadius: 2.5, bgcolor: "#f2f6fc" }}>
          <Typography sx={{ minWidth: 0, color: "#284c79", fontSize: { xs: 25, sm: 32, md: 36 }, fontWeight: 750, lineHeight: 1.4, wordBreak: "keep-all", overflowWrap: "anywhere" }}>{origin}</Typography>
          <Typography aria-hidden="true" sx={{ color: "#7595c2", fontSize: { xs: 26, sm: 34 } }}>→</Typography>
          <Typography sx={{ minWidth: 0, color: "#1d4fab", fontSize: { xs: 25, sm: 32, md: 36 }, fontWeight: 750, lineHeight: 1.4, wordBreak: "keep-all", overflowWrap: "anywhere" }}>{destination}</Typography>
        </Box>
        <Stack direction="row" useFlexGap sx={{ gap: 1.5, flexWrap: "wrap", mt: 1, px: { xs: 2, sm: 3 } }}>
          <Typography translate="no" sx={{ color: "#5e5e5e", fontSize: 12, fontFamily: "Arial, sans-serif", fontWeight: 400, letterSpacing: "normal", whiteSpace: "nowrap" }}>Google Maps</Typography>
          {attributions.map((item) => <Typography key={`${item.provider}-${item.providerUri ?? ""}`} sx={{ fontSize: 12, color: "#5e5e5e", overflowWrap: "anywhere" }}>{item.providerUri ? <a href={item.providerUri} target="_blank" rel="noopener noreferrer">{item.provider}</a> : item.provider}</Typography>)}
        </Stack>
        <Typography sx={{ mt: { xs: 2.5, sm: 3 }, color: "#53657d", fontSize: { xs: 17, sm: 19 }, lineHeight: 1.7, wordBreak: "keep-all" }}>
          먼저 여행에 필요한 준비물을 살펴보세요.
        </Typography>
      </Box>

      <Box component="section" aria-labelledby="global-cards-heading" sx={{ mt: { xs: 4, md: 5 } }}>
        <Typography id="global-cards-heading" component="h2" sx={{ color: "#1a2e4b", fontSize: { xs: 22, md: 26 }, fontWeight: 800, letterSpacing: "-0.035em" }}>
          플랜미 추천 글로벌 여행 준비
        </Typography>
        <Typography sx={{ mt: 1, mb: 2.5, color: "#64748b", fontSize: 14, lineHeight: 1.7 }}>
          여행 전 챙길 여섯 가지. 예약과 서비스 연결은 차근차근 준비하고 있어요.
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" }, gap: { xs: 1.5, md: 2 } }}>
          {PREPARATION_CARDS.map(({ title, caption, description, Icon, color, background }) => (
            <Box key={title} component="article" sx={{ bgcolor: "#fff", border: "1px solid #e2e9f2", borderRadius: 3, p: { xs: 2.5, md: 3 }, boxShadow: "0 4px 16px rgba(35, 65, 109, 0.025)" }}>
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
                <Box sx={{ width: 48, height: 48, borderRadius: 2.5, bgcolor: background, color, display: "grid", placeItems: "center" }}><Icon sx={{ fontSize: 26 }} /></Box>
                <Typography sx={{ color: "#65758a", fontSize: 12, fontWeight: 650, borderRadius: 1.5, bgcolor: "#f3f6fa", px: 1.25, py: 0.6 }}>연결 준비 중</Typography>
              </Stack>
              <Typography sx={{ color, fontSize: 12, fontWeight: 650, mb: 0.5 }}>{caption}</Typography>
              <Typography component="h3" sx={{ color: "#223550", fontSize: 21, fontWeight: 750 }}>{title}</Typography>
              <Typography sx={{ mt: 1, color: "#65748a", fontSize: 14, lineHeight: 1.75 }}>{description}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ mt: 4, display: "flex", justifyContent: "center" }}>
        <Button onClick={onSearchAgain} variant="outlined" startIcon={<ArrowBackRoundedIcon />} sx={{ minHeight: 48, px: 3, borderColor: "#c5d5eb", borderRadius: 2, fontWeight: 700 }}>다른 여행지 검색</Button>
      </Box>
    </Box>
  );
}
