"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ItineraryDisplayDto,
  PlanmeV3TransportMode,
} from "@planme/core";

type ScheduledVisitView = {
  contentId: string;
  title: string;
  startMinute: number;
  endMinute: number;
};

type V3ItineraryDetailProps = {
  itineraryId: string;
  phase: string;
  display: ItineraryDisplayDto | null;
  scheduledDays: Array<{
    day: number;
    visits: ScheduledVisitView[];
    meals: Array<{
      kind: "lunch" | "dinner";
      title: string;
      startMinute: number;
      endMinute: number;
      locationStatus: "tourapi" | "unlocated";
    }>;
    luggageEvents: Array<{
      kind: "handoff" | "delivered";
      title: string;
      minute: number;
    }>;
    idleBlocks: Array<{
      kind: "free_time" | "lodging_rest";
      startMinute: number;
      endMinute: number;
    }>;
  }>;
  estimatedWalkCount: number;
  lodging: { contentId: string; title: string } | null;
  editToken?: string;
  failedMessage?: string;
};

type PublicJobResponse =
  | { status: "processing"; phase: string; retryAfterMs: number }
  | { status: "ready"; revision: number }
  | { status: "failed"; message: string };

type TourSearchCandidate = {
  contentId: string;
  contentTypeId: number;
  title: string;
  address?: string;
};

export function V3ItineraryDetail({
  itineraryId,
  phase,
  display,
  scheduledDays,
  estimatedWalkCount,
  lodging,
  editToken,
  failedMessage,
}: V3ItineraryDetailProps) {
  const [currentPhase, setCurrentPhase] = useState(phase);
  const [statusMessage, setStatusMessage] = useState(failedMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transportMode, setTransportMode] = useState<PlanmeV3TransportMode>(
    display?.transportMode ?? "transit",
  );
  const initialVisitIds = useMemo(
    () => scheduledDays.flatMap((day) => day.visits.map((visit) => visit.contentId)),
    [scheduledDays],
  );
  const visitById = useMemo(
    () =>
      new Map(
        scheduledDays.flatMap((day) =>
          day.visits.map((visit) => [visit.contentId, visit] as const),
        ),
      ),
    [scheduledDays],
  );
  const [selectedVisitIds, setSelectedVisitIds] = useState(
    () => new Set(initialVisitIds),
  );
  const [orderedVisits, setOrderedVisits] = useState(() =>
    scheduledDays.map((day) => ({
      day: day.day,
      contentIds: day.visits.map((visit) => visit.contentId),
    })),
  );
  const [selectedLodging, setSelectedLodging] = useState(lodging);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TourSearchCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedAddDay, setSelectedAddDay] = useState(
    scheduledDays[0]?.day ?? 1,
  );
  const [addedPlaces, setAddedPlaces] = useState<
    Array<{ contentId: string; title: string; day: number }>
  >([]);
  const hasActiveDisplay = display !== null;
  const shouldPoll = !["ready", "failed"].includes(currentPhase);

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/gpt/itineraries/${encodeURIComponent(itineraryId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("STATUS_LOOKUP_FAILED");
        }
        const result = (await response.json()) as PublicJobResponse;
        if (cancelled) return;
        if (result.status === "ready") {
          window.location.reload();
          return;
        }
        if (result.status === "failed") {
          setCurrentPhase(hasActiveDisplay ? "ready" : "failed");
          setStatusMessage(result.message);
          setIsSubmitting(false);
          return;
        }
        setCurrentPhase(result.phase);
        timer = setTimeout(poll, Math.max(500, Math.min(2_000, result.retryAfterMs)));
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, 2_000);
        }
      }
    };

    timer = setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasActiveDisplay, itineraryId, shouldPoll]);

  const submitEdit = async () => {
    if (!display || !editToken || selectedVisitIds.size + addedPlaces.length === 0) {
      setStatusMessage("방문 장소를 하나 이상 남겨 주세요.");
      return;
    }
    setIsSubmitting(true);
    setStatusMessage("");
    const days = scheduledDays.map((day) => ({
      day: day.day,
      orderedVisitContentIds: [
        ...(orderedVisits.find((ordered) => ordered.day === day.day)?.contentIds ?? [])
          .filter((contentId) => selectedVisitIds.has(contentId)),
        ...addedPlaces
          .filter((place) => place.day === day.day)
          .map((place) => place.contentId),
      ],
    }));
    try {
      const response = await fetch(
        `/api/gpt/itineraries/${encodeURIComponent(itineraryId)}/edits`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: editToken,
            baseRevision: display.revision,
            transportMode,
            lodgingContentId: selectedLodging?.contentId,
            days,
          }),
        },
      );
      if (response.status === 409) {
        setStatusMessage("일정이 이미 변경되었습니다. 최신 일정을 다시 불러와 주세요.");
        setIsSubmitting(false);
        return;
      }
      if (!response.ok) {
        setStatusMessage("일정 변경을 시작하지 못했습니다.");
        setIsSubmitting(false);
        return;
      }
      const result = (await response.json()) as PublicJobResponse;
      if (result.status === "ready") {
        window.location.reload();
        return;
      }
      if (result.status === "failed") {
        setCurrentPhase("ready");
        setStatusMessage(result.message);
        setIsSubmitting(false);
        return;
      }
      setCurrentPhase(result.phase);
      setStatusMessage("기존 일정을 유지한 채 변경 경로를 계산하고 있습니다.");
    } catch {
      setStatusMessage("일정 변경 요청을 전송하지 못했습니다.");
      setIsSubmitting(false);
    }
  };

  const moveVisit = (day: number, contentId: string, offset: -1 | 1) => {
    setOrderedVisits((current) =>
      current.map((entry) => {
        if (entry.day !== day) return entry;
        const index = entry.contentIds.indexOf(contentId);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= entry.contentIds.length) {
          return entry;
        }
        const contentIds = [...entry.contentIds];
        [contentIds[index], contentIds[target]] = [
          contentIds[target],
          contentIds[index],
        ];
        return { ...entry, contentIds };
      }),
    );
  };

  const searchTourPlaces = async () => {
    if (!display || !editToken || searchQuery.trim().length < 2) {
      setStatusMessage("장소 검색어를 두 글자 이상 입력해 주세요.");
      return;
    }
    setIsSearching(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itineraryId,
          baseRevision: display.revision,
          token: editToken,
          query: searchQuery.trim(),
          limit: 10,
        }),
      });
      const payload = (await response.json()) as {
        candidates?: TourSearchCandidate[];
        message?: string;
      };
      if (!response.ok) {
        setStatusMessage(payload.message ?? "TourAPI 장소 검색에 실패했습니다.");
        setSearchResults([]);
        return;
      }
      setSearchResults(
        (payload.candidates ?? []).filter((candidate) =>
          [12, 14, 15, 28, 32, 38].includes(candidate.contentTypeId),
        ),
      );
    } catch {
      setStatusMessage("TourAPI 장소 검색 요청을 전송하지 못했습니다.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  if (!display) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-bold text-blue-600">PlanME · TourAPI</p>
        <h1 className="mt-2 text-3xl font-black text-slate-900">
          {currentPhase === "failed" ? "일정을 완성하지 못했습니다" : "일정을 만들고 있습니다"}
        </h1>
        <p className="mt-3 text-slate-600">
          {statusMessage || "확인된 장소와 서버 경로를 계산하는 중입니다. 추가 입력은 필요하지 않습니다."}
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      {currentPhase !== "ready" || statusMessage ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
          {statusMessage || "기존 일정을 유지한 채 변경 경로를 계산하고 있습니다."}
        </section>
      ) : null}

      <header className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-bold text-blue-600">PlanME · TourAPI</p>
        <h1 className="mt-2 text-3xl font-black text-slate-900">{display.title}</h1>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric label="Standard 이동" value={`${display.standardTotalMinutes}분`} />
          <Metric label="CarryME 이동" value={`${display.carrymeTotalMinutes}분`} />
          <Metric label="절약 시간" value={`${display.savedMinutes}분`} accent />
        </div>
        {estimatedWalkCount > 0 ? (
          <p className="mt-4 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
            예상 도보 {estimatedWalkCount}구간 · 지도 경로선 없음
          </p>
        ) : null}
      </header>

      <section className="grid gap-4">
        {scheduledDays.map((day) => (
          <article key={day.day} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-900">Day {day.day}</h2>
            <ol className="mt-4 grid gap-3">
              {[
                ...day.visits.map((visit) => ({
                  key: visit.contentId,
                  title: visit.title,
                  startMinute: visit.startMinute,
                  endMinute: visit.endMinute,
                  badge: "",
                })),
                ...day.meals.map((meal) => ({
                  key: `${meal.kind}:${meal.startMinute}`,
                  title: meal.title,
                  startMinute: meal.startMinute,
                  endMinute: meal.endMinute,
                  badge: meal.locationStatus === "unlocated" ? "일반 식사" : "TourAPI 식당",
                })),
                ...day.luggageEvents.map((event) => ({
                  key: `luggage:${event.kind}:${event.minute}`,
                  title: event.title,
                  startMinute: event.minute,
                  endMinute: event.minute,
                  badge: "CarryME 수하물",
                })),
                ...day.idleBlocks.map((block) => ({
                  key: `${block.kind}:${block.startMinute}`,
                  title:
                    block.kind === "lodging_rest" ? "숙소 휴식" : "자유시간",
                  startMinute: block.startMinute,
                  endMinute: block.endMinute,
                  badge: "서버 배치",
                })),
              ]
                .sort((left, right) => left.startMinute - right.startMinute)
                .map((event) => (
                  <li key={event.key} className="flex gap-4 rounded-xl bg-slate-50 p-4">
                    <time className="w-28 shrink-0 font-bold text-blue-700">
                      {event.startMinute === event.endMinute
                        ? formatMinute(event.startMinute)
                        : `${formatMinute(event.startMinute)}–${formatMinute(event.endMinute)}`}
                    </time>
                    <span className="font-semibold text-slate-900">
                      {event.title}
                      {event.badge ? (
                        <small className="ml-2 rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-600">
                          {event.badge}
                        </small>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ol>
          </article>
        ))}
      </section>

      {editToken ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">일정 조정</h2>
          <p className="mt-2 text-sm text-slate-600">
            장소 이름과 좌표는 TourAPI 스냅샷을 그대로 사용합니다. 변경 계산이 끝나기 전에는 현재 일정이 유지됩니다.
          </p>
          <label className="mt-5 block text-sm font-bold text-slate-700">
            전체 이동 수단
            <select
              value={transportMode}
              onChange={(event) => setTransportMode(event.target.value as PlanmeV3TransportMode)}
              disabled={isSubmitting || currentPhase !== "ready"}
              className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="transit">대중교통</option>
              <option value="drive">자동차</option>
            </select>
          </label>
          <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span className="font-bold text-slate-700">선택 숙소</span>
            <p className="mt-1 text-slate-900">
              {selectedLodging?.title ?? "TourAPI 숙소를 검색해 선택해 주세요."}
            </p>
          </div>
          <fieldset className="mt-5 grid gap-2" disabled={isSubmitting || currentPhase !== "ready"}>
            <legend className="mb-2 text-sm font-bold text-slate-700">유지할 방문 장소</legend>
            {orderedVisits.flatMap((day) =>
              day.contentIds.map((contentId, index) => {
                const visit = visitById.get(contentId);
                if (!visit) return [];
                return (
                <div key={visit.contentId} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedVisitIds.has(visit.contentId)}
                    onChange={(event) => {
                      setSelectedVisitIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(visit.contentId);
                        else next.delete(visit.contentId);
                        return next;
                      });
                    }}
                  />
                  <span className="truncate">Day {day.day} · {visit.title}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => moveVisit(day.day, contentId, -1)}
                    disabled={index === 0}
                    aria-label={`${visit.title} 위로 이동`}
                    className="rounded px-2 py-1 text-blue-700 disabled:text-slate-300"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveVisit(day.day, contentId, 1)}
                    disabled={index === day.contentIds.length - 1}
                    aria-label={`${visit.title} 아래로 이동`}
                    className="rounded px-2 py-1 text-blue-700 disabled:text-slate-300"
                  >
                    ↓
                  </button>
                </div>
                );
              }),
            )}
          </fieldset>
          <div className="mt-6 border-t border-slate-200 pt-5">
            <label className="text-sm font-bold text-slate-700" htmlFor="v3-place-search">
              TourAPI 숙소·방문 장소 검색
            </label>
            <label className="mt-3 block text-sm text-slate-600">
              방문 장소를 추가할 일차
              <select
                value={selectedAddDay}
                onChange={(event) => setSelectedAddDay(Number(event.target.value))}
                disabled={isSubmitting || currentPhase !== "ready"}
                className="ml-2 rounded-lg border border-slate-300 px-2 py-1"
              >
                {scheduledDays.map((day) => (
                  <option key={day.day} value={day.day}>Day {day.day}</option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="v3-place-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                disabled={isSubmitting || currentPhase !== "ready"}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2"
                placeholder="공식 장소명 검색"
              />
              <button
                type="button"
                onClick={searchTourPlaces}
                disabled={isSearching || isSubmitting || currentPhase !== "ready"}
                className="rounded-xl border border-blue-600 px-4 py-2 font-bold text-blue-700 disabled:border-slate-300 disabled:text-slate-400"
              >
                {isSearching ? "검색 중" : "검색"}
              </button>
            </div>
            {searchResults.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {searchResults.map((candidate) => {
                  const isLodging = candidate.contentTypeId === 32;
                  const alreadyAdded = isLodging
                    ? selectedLodging?.contentId === candidate.contentId
                    : addedPlaces.some(
                        (place) => place.contentId === candidate.contentId,
                      ) || initialVisitIds.includes(candidate.contentId);
                  return (
                    <li key={candidate.contentId} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                      <div>
                        <p className="font-semibold text-slate-900">{candidate.title}</p>
                        {candidate.address ? (
                          <p className="mt-1 text-xs text-slate-500">{candidate.address}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={alreadyAdded}
                        onClick={() => {
                          if (isLodging) {
                            setSelectedLodging({
                              contentId: candidate.contentId,
                              title: candidate.title,
                            });
                            return;
                          }
                          setAddedPlaces((current) => [
                            ...current,
                            {
                              contentId: candidate.contentId,
                              title: candidate.title,
                              day: selectedAddDay,
                            },
                          ]);
                        }}
                        className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-bold text-blue-700 disabled:text-slate-400"
                      >
                        {alreadyAdded
                          ? "선택됨"
                          : isLodging
                            ? "숙소로 선택"
                            : `Day ${selectedAddDay} 추가`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {addedPlaces.length > 0 ? (
              <ul className="mt-3 grid gap-1 text-sm text-slate-600">
                {addedPlaces.map((place) => (
                  <li key={place.contentId} className="flex items-center justify-between">
                    <span>Day {place.day} 추가: {place.title}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAddedPlaces((current) =>
                          current.filter((item) => item.contentId !== place.contentId),
                        )
                      }
                      className="font-bold text-red-600"
                    >
                      취소
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            onClick={submitEdit}
            disabled={isSubmitting || currentPhase !== "ready"}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isSubmitting ? "변경 계산 중" : "변경 적용"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-black ${accent ? "text-emerald-600" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

function formatMinute(value: number) {
  const hours = String(Math.floor(value / 60)).padStart(2, "0");
  const minutes = String(value % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}
