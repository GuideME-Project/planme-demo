"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import RadioButtonCheckedRoundedIcon from "@mui/icons-material/RadioButtonCheckedRounded";
import { Box, Button, LinearProgress, Stack, Typography } from "@mui/material";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  advancePlanmeGenerationAction,
  type PlanmeGenerationProgressResult,
} from "@/app/planme-generation-actions";
import type { ItineraryPhase } from "@/lib/planme-v3/job-store";

type PlanmeGenerationProgressProps = {
  itineraryId: string;
  initialPhase: ItineraryPhase;
};

const STEPS = [
  { label: "출발지와 목적지 확인", caption: "여행의 시작점과 도착 지역을 확인해요." },
  { label: "여행 장소 찾기", caption: "일정에 어울리는 장소를 살펴보고 있어요." },
  { label: "AI 일정 구성", caption: "동선과 시간을 고려해 순서를 정리해요." },
  { label: "이동 경로 계산", caption: "일정에 필요한 이동 시간을 계산해요." },
  { label: "일정 마무리", caption: "추천 일정을 보기 좋게 정리하고 있어요." },
] as const;

export function PlanmeGenerationProgress({
  itineraryId,
  initialPhase,
}: PlanmeGenerationProgressProps) {
  const router = useRouter();
  const [phase, setPhase] = useState(initialPhase);
  const [retryAfterMs, setRetryAfterMs] = useState(300);
  const [requestVersion, setRequestVersion] = useState(0);
  const [failure, setFailure] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPending, startTransition] = useTransition();
  const inFlightRef = useRef(false);
  const activeStep = phaseToStep(phase);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (failure || phase === "ready" || phase === "failed") {
      return;
    }

    const timer = window.setTimeout(() => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      startTransition(async () => {
        try {
          const result = await advancePlanmeGenerationAction(itineraryId);
          applyProgressResult(result, {
            onProcessing: (nextPhase, nextRetryAfterMs) => {
              setPhase(nextPhase);
              setRetryAfterMs(nextRetryAfterMs);
              setRequestVersion((current) => current + 1);
            },
            onReady: () => router.refresh(),
            onFailed: setFailure,
          });
        } catch {
          setFailure("진행 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } finally {
          inFlightRef.current = false;
        }
      });
    }, retryAfterMs);

    return () => window.clearTimeout(timer);
  }, [failure, itineraryId, phase, requestVersion, retryAfterMs, router]);

  return (
    <Box component="main" sx={{ minHeight: "100dvh", bgcolor: "#f8fbff" }}>
      <Box
        component="header"
        sx={{
          height: { xs: 76, md: 96 },
          display: "flex",
          alignItems: "center",
          px: { xs: 2.5, md: 3.5 },
          bgcolor: "#fff",
          borderBottom: "1px solid rgba(23, 50, 91, 0.06)",
        }}
      >
        <Box sx={{ position: "relative", width: { xs: 270, md: 320 }, maxWidth: "76vw", aspectRatio: "1707 / 237" }}>
          <Image
            src="/brand/planme-logo.png"
            alt="PlanME by GuideME"
            fill
            priority
            sizes="(max-width: 899px) 270px, 320px"
            style={{ objectFit: "contain" }}
          />
        </Box>
      </Box>

      <Box
        sx={{
          minHeight: { xs: "calc(100dvh - 76px)", md: "calc(100dvh - 96px)" },
          display: "grid",
          placeItems: "center",
          px: 2,
          py: { xs: 4, md: 7 },
          backgroundImage: 'url("/brand/planme-search-background.png")',
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <Box
          sx={{
            width: "100%",
            maxWidth: 760,
            border: "1px solid rgba(153, 168, 193, 0.46)",
            borderRadius: { xs: 3, md: 4 },
            bgcolor: "rgba(255, 255, 255, 0.96)",
            boxShadow: "0 20px 56px rgba(57, 91, 139, 0.14)",
            px: { xs: 2.5, sm: 5, md: 7 },
            py: { xs: 3.5, sm: 5, md: 6 },
          }}
        >
          {failure ? (
            <FailureState message={failure} />
          ) : (
            <>
              <Box sx={{ textAlign: "center" }}>
                <Typography sx={{ color: "#0b66e4", fontSize: 14, fontWeight: 800, letterSpacing: "0.04em" }}>
                  AI 여행 일정 생성 중
                </Typography>
                <Typography component="h1" sx={{ mt: 1.25, color: "#17233c", fontSize: { xs: 27, sm: 34 }, fontWeight: 800, letterSpacing: "-0.035em" }}>
                  가벼운 여행을 준비하고 있어요
                </Typography>
                <Typography sx={{ mt: 1.25, color: "#6f7c91", fontSize: { xs: 15, sm: 17 }, lineHeight: 1.65 }}>
                  장소와 이동 경로를 확인한 뒤 일정 화면으로 자동 이동합니다.
                </Typography>
              </Box>

              <LinearProgress
                aria-label="일정 생성 진행 중"
                sx={{
                  mt: 4,
                  height: 6,
                  borderRadius: 999,
                  bgcolor: "#e8eef8",
                  "& .MuiLinearProgress-bar": { borderRadius: 999, bgcolor: "#1660df" },
                }}
              />

              <Stack spacing={0.5} sx={{ mt: 3.5 }}>
                {STEPS.map((step, index) => (
                  <ProgressStep
                    key={step.label}
                    label={step.label}
                    caption={step.caption}
                    state={index < activeStep ? "done" : index === activeStep ? "active" : "waiting"}
                  />
                ))}
              </Stack>

              <Stack direction="row" spacing={0.75} sx={{ mt: 3.5, alignItems: "center", justifyContent: "center", color: "#7b879a" }}>
                <AccessTimeRoundedIcon sx={{ fontSize: 18 }} />
                <Typography sx={{ fontSize: 14, fontWeight: 650 }}>
                  {formatElapsed(elapsedSeconds)} 경과{isPending ? " · 현재 단계를 처리하고 있어요" : ""}
                </Typography>
              </Stack>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function ProgressStep({
  label,
  caption,
  state,
}: {
  label: string;
  caption: string;
  state: "done" | "active" | "waiting";
}) {
  const Icon = state === "done"
    ? CheckCircleRoundedIcon
    : state === "active"
      ? RadioButtonCheckedRoundedIcon
      : CircleOutlinedIcon;

  return (
    <Stack
      direction="row"
      spacing={1.75}
      sx={{
        alignItems: "center",
        borderRadius: 2.5,
        px: 2,
        py: 1.5,
        bgcolor: state === "active" ? "#eef5ff" : "transparent",
      }}
    >
      <Icon sx={{ color: state === "waiting" ? "#c0c8d5" : state === "done" ? "#27a26a" : "#1660df", fontSize: 25 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ color: state === "waiting" ? "#8b96a8" : "#17233c", fontSize: 16, fontWeight: state === "active" ? 800 : 700 }}>
          {label}
        </Typography>
        {state === "active" ? (
          <Typography sx={{ mt: 0.25, color: "#66758c", fontSize: 13.5 }}>
            {caption}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

function FailureState({ message }: { message: string }) {
  return (
    <Box sx={{ py: 3, textAlign: "center" }}>
      <Typography component="h1" sx={{ color: "#17233c", fontSize: 28, fontWeight: 800 }}>
        일정을 완성하지 못했어요
      </Typography>
      <Typography sx={{ mt: 1.5, color: "#6f7c91", lineHeight: 1.65 }}>
        {message}
      </Typography>
      <Button href="/" variant="contained" sx={{ mt: 3, minWidth: 150, bgcolor: "#1660df", boxShadow: "none" }}>
        조건 수정하기
      </Button>
    </Box>
  );
}

function phaseToStep(phase: ItineraryPhase) {
  if (phase === "queued" || phase === "resolving_anchors") return 0;
  if (phase === "collecting_candidates") return 1;
  if (phase === "arranging" || phase === "scheduling") return 2;
  if (phase === "routing") return 3;
  return 4;
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function applyProgressResult(
  result: PlanmeGenerationProgressResult,
  handlers: {
    onProcessing: (phase: ItineraryPhase, retryAfterMs: number) => void;
    onReady: () => void;
    onFailed: (message: string) => void;
  },
) {
  if (result.status === "processing") {
    handlers.onProcessing(result.phase, result.retryAfterMs);
  } else if (result.status === "ready") {
    handlers.onReady();
  } else {
    handlers.onFailed(result.message);
  }
}
