"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Stack } from "@mui/material";
import dynamic from "next/dynamic";
const ItineraryDashboard = dynamic(() =>
  import("@/components/itinerary/ItineraryDashboard").then(
    (module) => module.ItineraryDashboard,
  ),
);
import {
  loadPlanmeInlineItineraryAction,
  type PlanmeInlineItineraryResult,
} from "@/app/planme-search-actions";
import { PlanmeGenerationProgress } from "./PlanmeGenerationProgress";

export function PlanmeInlineItinerary({
  initialResult,
}: {
  initialResult: PlanmeInlineItineraryResult;
}) {
  const [result, setResult] = useState(initialResult);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
    sectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);
  const showCompleted = useCallback(async () => {
    const completed = await loadPlanmeInlineItineraryAction(
      initialResult.itineraryId,
    );
    if (!completed?.itinerary)
      throw new Error("일정 결과를 확인할 수 없습니다.");
    setResult(completed);
  }, [initialResult.itineraryId]);
  return (
    <Box
      ref={sectionRef}
      component="section"
      id="trip-result"
      aria-label="여행 일정 결과"
      tabIndex={-1}
      sx={{ mt: 6, mb: 8, scrollMarginTop: 24, minWidth: 0 }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "flex-end", mb: 2 }}
      >
        <Button href="#trip-search">다시 검색하기</Button>
        <Button
          href={`/itinerary/${encodeURIComponent(result.itineraryId)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          일정 공유 페이지 열기
        </Button>
      </Stack>
      {result.itinerary ? (
        <ItineraryDashboard
          key={result.itineraryId}
          itinerary={result.itinerary}
          compact
          embedded
          editingEnabled={false}
          routeFinalized
          routeRevision={result.revision}
        />
      ) : (
        <PlanmeGenerationProgress
          itineraryId={result.itineraryId}
          initialPhase={result.phase}
          embedded
          onReady={showCompleted}
        />
      )}
    </Box>
  );
}
