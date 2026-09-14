"use client";
import { translateError } from "@/lib/i18n/messages";
import { useLocale } from "@/components/i18n/LocaleProvider";

import AdjustRoundedIcon from "@mui/icons-material/AdjustRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DirectionsBusRoundedIcon from "@mui/icons-material/DirectionsBusRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Divider,
  FormHelperText,
  IconButton,
  Popover,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { PlanmeGlobalPreparation } from "./PlanmeGlobalPreparation";
import { PlanmeInlineItinerary } from "./PlanmeInlineItinerary";
import { PlanmePlaceInput } from "./PlanmePlaceInput";
import type { PlanmePlaceSelection } from "@/lib/planme-places";
import {
  type PlanmeSearchActionState,
  startPlanmeSearchAction,
  loadPlanmeInlineItineraryAction,
} from "@/app/planme-search-actions";

type PlanmeSearchHomeProps = {
  initialDestination: string;
  initialSubmissionId: string;
};

import { readSearchDraft, saveSearchDraft } from "@/lib/i18n/search-draft";

type TransportMode = "drive" | "transit" | "";

export function PlanmeSearchHome({
  initialDestination,
  initialSubmissionId,
}: PlanmeSearchHomeProps) {
  const { t, locale } = useLocale();
  const [restoredState, setRestoredState] = useState<PlanmeSearchActionState>({});
  const [restoring, setRestoring] = useState(true);
  const [originSelection, setOriginSelection] = useState<PlanmePlaceSelection | null>(null);
  const [destinationSelection, setDestinationSelection] = useState<PlanmePlaceSelection | null>(null);
  const [consumedTokens, setConsumedTokens] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState(
    async (previousState: PlanmeSearchActionState, formData: FormData) => {
      try {
        return await startPlanmeSearchAction(previousState, formData);
      } finally {
        const tokens = [formData.get("originSessionToken"), formData.get("destinationSessionToken")]
          .filter((token): token is string => typeof token === "string" && Boolean(token));
        setConsumedTokens((current) => [...new Set([...current, ...tokens])]);
      }
    },
    {} satisfies PlanmeSearchActionState,
  );
  const [destination, setDestination] = useState(initialDestination);
  const [origin, setOrigin] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("");
  const [submissionId, setSubmissionId] = useState(initialSubmissionId);
  const [durationAnchor, setDurationAnchor] = useState<HTMLElement | null>(null);
  const destinationInputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);
  const currentState = state.submissionId ? state : restoredState;
  const visibleState = useMemo<PlanmeSearchActionState>(() => !pending && currentState.submissionId === submissionId ? currentState : {}, [pending, currentState, submissionId]);
  const globalPreparation = currentState.globalPreparation?.submissionId === submissionId
    ? currentState.globalPreparation
    : undefined;

  useEffect(() => {
    if (!pending) submittingRef.current = false;
  }, [pending, state]);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const draft = readSearchDraft(window.sessionStorage, window.location.search);
        if (!draft) return;
        const result = draft.state.itineraryResult;
        if (!active) return;
        setOrigin(draft.origin);
        setDestination(draft.destination);
        setDurationDays(draft.durationDays);
        setTransportMode(draft.transportMode);
        setSubmissionId(draft.submissionId);
        setOriginSelection(draft.originSelection);
        setDestinationSelection(draft.destinationSelection);
        setConsumedTokens(draft.consumedTokens);
        let refreshed = result;
        try { if (result) refreshed = await loadPlanmeInlineItineraryAction(result.itineraryId) ?? result; }
        catch { /* Keep the itinerary ID so its result can be retried without regenerating. */ }
        if (active) setRestoredState({ ...draft.state, itineraryResult: refreshed });
      } catch {
        // Storage can be disabled; ordinary searching must remain available.
      } finally {
        if (active) setRestoring(false);
      }
    }
    void restore();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const save = (event: Event) => {
      if (pending || restoring || submittingRef.current) { event.preventDefault(); return; }
      try {
        saveSearchDraft(window.sessionStorage, {
          query: window.location.search, origin, destination, durationDays, transportMode,
          submissionId, originSelection, destinationSelection, consumedTokens, state: visibleState,
        });
      } catch { event.preventDefault(); }
    };
    window.addEventListener("planme:before-language-change", save);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("planme:before-language-change", save);
      window.removeEventListener("pagehide", save);
    };
  }, [pending, restoring, origin, destination, durationDays, transportMode, submissionId, originSelection, destinationSelection, consumedTokens, visibleState]);

  const rotateSubmissionId = () => setSubmissionId(crypto.randomUUID());
  const selectedDurationDays = durationDays ? Number(durationDays) : 1;

  const searchAgain = () => {
    setDestination("");
    setDestinationSelection(null);
    rotateSubmissionId();
    requestAnimationFrame(() => destinationInputRef.current?.focus());
  };

  const selectDuration = (value: number) => {
    setDurationDays(String(Math.min(14, Math.max(1, value))));
    rotateSubmissionId();
  };

  return (
    <Box
      component="section"
      id="trip-search"
      aria-label={t("여행 일정 검색")}
      sx={{ scrollMarginTop: 24, position: "relative", zIndex: 2 }}
    >
      {globalPreparation ? (
        <PlanmeGlobalPreparation
          origin={globalPreparation.origin}
          internationalSide={globalPreparation.internationalSide}
          destination={globalPreparation.destination}
          countryName={globalPreparation.countryName}
          attributions={globalPreparation.attributions}
          onSearchAgain={searchAgain}
        />
      ) : <Box
        sx={{
          display: "flex",
        }}
      >
        <Box
          component="form"
          action={formAction}
          aria-busy={pending}
          onSubmit={(event) => {
            if (pending || restoring || submittingRef.current) {
              event.preventDefault();
              return;
            }
            submittingRef.current = true;
            setDurationAnchor(null);
          }}
          noValidate
          sx={{
            width: "100%",
            mx: "auto",
            maxWidth: 1396,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              xl: "1.08fr 1fr minmax(150px, 0.85fr) 1.12fr auto",
            },
            alignItems: "stretch",
            p: { xs: 2.25, sm: 3, xl: 2.25 },
            bgcolor: "rgba(255, 255, 255, 0.96)",
            border: "1px solid rgba(153, 168, 193, 0.55)",
            borderRadius: { xs: 3, xl: 2.25 },
            boxShadow: "0 12px 32px rgba(57, 91, 139, 0.10)",
          }}
        >
          <input type="hidden" name="submissionId" value={submissionId} />
          <input type="hidden" name="transportMode" value={transportMode} />
          <input type="hidden" name="durationDays" value={durationDays} />
          <input type="hidden" name="originPlaceId" value={originSelection?.placeId ?? ""} />
          <input type="hidden" name="destinationPlaceId" value={destinationSelection?.placeId ?? ""} />
          <input type="hidden" name="originSessionToken" value={originSelection && !consumedTokens.includes(originSelection.sessionToken) ? originSelection.sessionToken : ""} />
          <input type="hidden" name="destinationSessionToken" value={destinationSelection && !consumedTokens.includes(destinationSelection.sessionToken) ? destinationSelection.sessionToken : ""} />

          <SearchField
            label={t("Departure")}
            labelFor="planme-origin"
            error={visibleState.fieldErrors?.origin}
            icon={<AdjustRoundedIcon />}
            divider
          >
            <PlanmePlaceInput
              id="planme-origin"
              name="origin"
              label={t("Departure")}
              selection={originSelection}
              disabled={pending || restoring}
              value={origin}
              onValueChange={(value, selection) => {
                setOrigin(value);
                setOriginSelection(selection);
                rotateSubmissionId();
              }}
            />
          </SearchField>

          <SearchField
            label={t("Destination")}
            labelFor="planme-destination"
            error={visibleState.fieldErrors?.destination}
            icon={<LocationOnOutlinedIcon />}
            divider
          >
            <PlanmePlaceInput
              id="planme-destination"
              name="destination"
              label={t("Destination")}
              selection={destinationSelection}
              inputRef={destinationInputRef}
              disabled={pending || restoring}
              value={destination}
              onValueChange={(value, selection) => {
                setDestination(value);
                setDestinationSelection(selection);
                rotateSubmissionId();
              }}
            />
          </SearchField>

          <SearchField
            label={t("Date")}
            labelFor="planme-duration"
            error={!durationDays ? visibleState.fieldErrors?.durationDays : undefined}
            divider
          >
            <ButtonBase
              id="planme-duration"
              disabled={pending || restoring}
              aria-label={t("여행 기간 선택")}
              aria-haspopup="dialog"
              aria-expanded={Boolean(durationAnchor)}
              onClick={(event) => setDurationAnchor(event.currentTarget)}
              sx={{
                width: "100%",
                minHeight: 42,
                mt: 0.5,
                justifyContent: "flex-start",
                borderRadius: 1,
                textAlign: "left",
              }}
            >
              <Typography
                sx={{
                  minWidth: 0,
                  flex: 1,
                  color: durationDays ? "#17233c" : "#8993a5",
                  fontSize: { xs: 18, xl: 20 },
                  fontWeight: 650,
                  whiteSpace: "nowrap",
                  lineHeight: 1.4,
                }}
              >
                {durationDays ? t(formatDuration(selectedDurationDays)) : t("Select Dates")}
              </Typography>
              <KeyboardArrowDownRoundedIcon sx={{ ml: 0.25, color: "#79859a", fontSize: 22 }} />
            </ButtonBase>

            <Popover
              open={Boolean(durationAnchor)}
              anchorEl={durationAnchor}
              onClose={() => setDurationAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
              transformOrigin={{ vertical: "top", horizontal: "center" }}
              slotProps={{
                paper: {
                  sx: {
                    width: 306,
                    maxWidth: "calc(100vw - 32px)",
                    mt: 1.25,
                    px: 3,
                    py: 2.5,
                    border: "1px solid #d5dce7",
                    borderRadius: 2,
                    boxShadow: "0 14px 32px rgba(31, 55, 88, 0.14)",
                  },
                },
              }}
            >
              <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <DurationStepButton
                  aria-label={t("여행 기간 하루 줄이기")}
                  disabled={selectedDurationDays <= 1}
                  onClick={() => selectDuration(selectedDurationDays - 1)}
                >
                  <RemoveRoundedIcon />
                </DurationStepButton>
                <Box sx={{ minWidth: 120, textAlign: "center" }}>
                  <Typography sx={{ color: "#17233c", fontSize: 25, fontWeight: 750 }}>
                    {t(formatDuration(selectedDurationDays))}
                  </Typography>
                  <Typography sx={{ mt: 0.5, color: "#8993a5", fontSize: 13.5, fontWeight: 600 }}>{t("최대 13박 14일")}</Typography>
                </Box>
                <DurationStepButton
                  aria-label={t("여행 기간 하루 늘리기")}
                  disabled={selectedDurationDays >= 14}
                  onClick={() => selectDuration(selectedDurationDays + 1)}
                >
                  <AddRoundedIcon />
                </DurationStepButton>
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Button
                fullWidth
                onClick={() => selectDuration(1)}
                sx={{ color: "#0967e8", fontWeight: 750 }}
              >{t("당일치기")}</Button>
            </Popover>
          </SearchField>

          <SearchField
            label={t("이동수단")}
            error={!transportMode ? visibleState.fieldErrors?.transportMode : undefined}
          >
            <ToggleButtonGroup
              disabled={pending || restoring}
              exclusive
              value={transportMode}
              onChange={(_event, value: TransportMode | null) => {
                if (value) {
                  setTransportMode(value);
                  rotateSubmissionId();
                }
              }}
              aria-label={t("이동수단")}
              sx={{
                mt: 1.1,
                width: "100%",
                gap: 1,
                "& .MuiToggleButtonGroup-grouped": {
                  m: 0,
                  border: "1px solid #d5dbe6",
                  borderRadius: "6px !important",
                },
              }}
            >
              <TransportButton value="drive" aria-label={t("자동차")}>
                <DirectionsCarRoundedIcon fontSize="small" />{t("자동차")}</TransportButton>
              <TransportButton value="transit" aria-label={t("대중교통")}>
                <DirectionsBusRoundedIcon fontSize="small" />{t("대중교통")}</TransportButton>
            </ToggleButtonGroup>
          </SearchField>

          <Box sx={{ display: "flex", alignItems: "stretch", gridColumn: { sm: "1 / -1", xl: "auto" }, pl: { xl: 2.25 } }}>
            <Button
              type="submit"
              variant="contained"
              disabled={pending || restoring}
              startIcon={
                pending ? <CircularProgress size={20} color="inherit" /> : <SearchRoundedIcon />
              }
              sx={{
                width: { xs: "100%", xl: 158 },
                minHeight: { xs: 58, xl: 106 },
                mt: { xs: 2.25, xl: 0 },
                borderRadius: 2,
                bgcolor: "#1660df",
                boxShadow: "none",
                fontSize: 19,
                fontWeight: 750,
                "&:hover": { bgcolor: "#0f50c4", boxShadow: "none" },
                "&.Mui-disabled": {
                  bgcolor: "#dbe9ff",
                  color: "#3973c9",
                },
              }}
            >
              {pending ? t("여행지 확인 중") : t("Search")}
            </Button>
          </Box>

          {visibleState.error ? (
            <Typography
              role="alert"
              color="error"
              sx={{ gridColumn: "1 / -1", mt: 1.5, px: 1, fontSize: 14 }}
            >
              {translateError(locale, visibleState.error)}
            </Typography>
          ) : null}
        </Box>
      </Box>}
      {visibleState.itineraryResult && <PlanmeInlineItinerary key={visibleState.itineraryResult.itineraryId} initialResult={visibleState.itineraryResult} />}
    </Box>
  );
}

type SearchFieldProps = {
  label: string;
  labelFor?: string;
  error?: string;
  icon?: React.ReactNode;
  divider?: boolean;
  children: React.ReactNode;
};

function SearchField({ label, labelFor, error, icon, divider, children }: SearchFieldProps) {
  const { t, locale } = useLocale();
  return (
    <Box
      sx={{
        minWidth: 0,
        px: { xs: 1, xl: 2.75 },
        py: { xs: 2, xl: 0.5 },
        borderBottom: { xs: divider ? "1px solid #e3e7ee" : "none", xl: "none" },
        borderRight: { xs: "none", xl: divider ? "1px solid #cfd6e2" : "none" },
      }}
    >
      <Typography
        component="label"
        htmlFor={labelFor}
        sx={{ display: "block", color: "#0967e8", fontSize: 16, fontWeight: 750 }}
      >
        {t(label)}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
        {icon ? <Box sx={{ color: "#a0a9ba", display: "flex" }}>{icon}</Box> : null}
      </Stack>
      {error ? <FormHelperText error sx={{ mt: 1, lineHeight: 1.5 }}>{translateError(locale, error)}</FormHelperText> : null}
    </Box>
  );
}

function TransportButton({ children, ...props }: React.ComponentProps<typeof ToggleButton>) {
  return (
    <ToggleButton
      {...props}
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 48,
        gap: 0.8,
        px: 1.5,
        py: 0.9,
        color: "#4b5566",
        borderColor: "#d5dbe6",
        fontSize: 16,
        fontWeight: 650,
        textTransform: "none",
        whiteSpace: "nowrap",
        "&.Mui-selected": {
          color: "#0b5dd9",
          bgcolor: "#eaf2ff",
          borderColor: "#0b66e8",
        },
        "&.Mui-selected:hover": { bgcolor: "#dfeaff" },
      }}
    >
      {children}
    </ToggleButton>
  );
}

function DurationStepButton(props: React.ComponentProps<typeof IconButton>) {
  return (
    <IconButton
      {...props}
      sx={{
        width: 42,
        height: 42,
        border: "1px solid #bec8d8",
        color: "#627087",
        "&:hover": { bgcolor: "#f3f7fc" },
        "&.Mui-disabled": { borderColor: "#e0e5ed", color: "#c4cbd6" },
      }}
    />
  );
}

function formatDuration(days: number) {
  return days === 1 ? "당일치기" : `${days - 1}박 ${days}일`;
}
