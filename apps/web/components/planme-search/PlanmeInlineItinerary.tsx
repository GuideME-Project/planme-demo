"use client";
import { PlanmeResultTheme } from "./PlanmeResultTheme";
import { useLocale } from "@/components/i18n/LocaleProvider";

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
  const { t, locale } = useLocale();
  const [loadFailed, setLoadFailed] = useState(false);
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
    setLoadFailed(false);
    setResult(completed);
  }, [initialResult.itineraryId]);
  useEffect(() => {
    if (initialResult.itinerary || initialResult.phase !== "ready") return;
    let active = true;
    void loadPlanmeInlineItineraryAction(initialResult.itineraryId).then((completed) => {
      if (!active) return;
      if (completed?.itinerary) setResult(completed);
      else setLoadFailed(true);
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [initialResult.itinerary, initialResult.phase, initialResult.itineraryId]);
  return (
    <PlanmeResultTheme>
    <Box
      ref={sectionRef}
      component="section"
      id="trip-result"
      data-itinerary-id={result.itineraryId}
      aria-label={t("여행 일정 결과")}
      tabIndex={-1}
      sx={{ mt: 6, mb: 8, scrollMarginTop: 24, minWidth: 0 }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: "flex-end", mb: 2 }}
      >
        <Button href="#trip-search">{t("다시 검색하기")}</Button>
      </Stack>
      {locale === "en" && <Box component="p" sx={{ color: "text.secondary", fontSize: 13 }}>{t("원문 안내")}</Box>}
      {result.itinerary ? (
        <ItineraryDashboard
          key={result.itineraryId}
          itinerary={result.itinerary}
          flightContext={result.flightContext}
          compact
          embedded
          editingEnabled={false}
          routeFinalized
          routeRevision={result.revision}
        />
      ) : result.phase === "ready" ? (
        <Box role="status">
          <p>{t(loadFailed ? "일정 결과를 불러오지 못했습니다. 다시 시도해 주세요." : "불러오는 중입니다.")}</p>
          {loadFailed && <Button onClick={() => { setLoadFailed(false); void showCompleted().catch(() => setLoadFailed(true)); }}>{t("다시 시도")}</Button>}
        </Box>
      ) : (
        <PlanmeGenerationProgress
          itineraryId={result.itineraryId}
          initialPhase={result.phase}
          embedded
          onReady={showCompleted}
        />
      )}
    </Box>
    </PlanmeResultTheme>
  );
}
