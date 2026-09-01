"use client";

import AdjustRoundedIcon from "@mui/icons-material/AdjustRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
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
  InputBase,
  Popover,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import Image from "next/image";
import { useActionState, useRef, useState } from "react";
import {
  type PlanmeSearchActionState,
  startPlanmeSearchAction,
} from "@/app/planme-search-actions";

type PlanmeSearchHomeProps = {
  initialDestination: string;
  initialSubmissionId: string;
};

type TransportMode = "drive" | "transit" | "";

export function PlanmeSearchHome({
  initialDestination,
  initialSubmissionId,
}: PlanmeSearchHomeProps) {
  const [state, formAction, pending] = useActionState(
    startPlanmeSearchAction,
    {} satisfies PlanmeSearchActionState,
  );
  const [destination, setDestination] = useState(initialDestination);
  const [origin, setOrigin] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("");
  const [submissionId, setSubmissionId] = useState(initialSubmissionId);
  const [durationAnchor, setDurationAnchor] = useState<HTMLElement | null>(null);
  const durationPaperRef = useRef<HTMLDivElement | null>(null);

  const rotateSubmissionId = () => setSubmissionId(crypto.randomUUID());
  const selectedDurationDays = durationDays ? Number(durationDays) : 1;

  const selectDuration = (value: number) => {
    setDurationDays(String(Math.min(14, Math.max(1, value))));
    rotateSubmissionId();
  };

  const closeDurationOnOutsidePointerDown = (
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const target = event.target as Node;

    if (
      durationAnchor &&
      !durationAnchor.contains(target) &&
      !durationPaperRef.current?.contains(target)
    ) {
      setDurationAnchor(null);
    }
  };

  return (
    <Box
      component="main"
      onPointerDownCapture={closeDurationOnOutsidePointerDown}
      sx={{ minHeight: "100dvh", bgcolor: "#f8fbff" }}
    >
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
        <Box
          sx={{
            position: "relative",
            width: { xs: 270, md: 320 },
            maxWidth: "76vw",
            aspectRatio: "1707 / 237",
          }}
        >
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
          display: "flex",
          alignItems: { xs: "flex-start", md: "center" },
          px: { xs: 2, sm: 4, lg: 5.5 },
          py: { xs: 4, md: 8 },
          backgroundImage: 'url("/brand/planme-search-background.png")',
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <Box
          component="form"
          action={formAction}
          noValidate
          sx={{
            width: "100%",
            mx: "auto",
            maxWidth: 1396,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "1.08fr 1fr 0.64fr 1.12fr auto",
            },
            alignItems: "stretch",
            p: { xs: 2.25, sm: 3, md: 2.25 },
            bgcolor: "rgba(255, 255, 255, 0.96)",
            border: "1px solid rgba(153, 168, 193, 0.55)",
            borderRadius: { xs: 3, md: 2.25 },
            boxShadow: "0 12px 32px rgba(57, 91, 139, 0.10)",
          }}
        >
          <input type="hidden" name="submissionId" value={submissionId} />
          <input type="hidden" name="transportMode" value={transportMode} />
          <input type="hidden" name="durationDays" value={durationDays} />

          <SearchField
            label="출발지"
            labelFor="planme-origin"
            error={state.fieldErrors?.origin}
            icon={<AdjustRoundedIcon />}
            divider
          >
            <InputBase
              id="planme-origin"
              name="origin"
              value={origin}
              onChange={(event) => {
                setOrigin(event.target.value);
                rotateSubmissionId();
              }}
              placeholder="출발지"
              inputProps={{ "aria-label": "출발지", maxLength: 100 }}
              sx={inputSx}
            />
          </SearchField>

          <SearchField
            label="목적지"
            labelFor="planme-destination"
            error={state.fieldErrors?.destination}
            icon={<LocationOnOutlinedIcon />}
            divider
          >
            <InputBase
              id="planme-destination"
              name="destination"
              value={destination}
              onChange={(event) => {
                setDestination(event.target.value);
                rotateSubmissionId();
              }}
              placeholder="목적지"
              inputProps={{ "aria-label": "목적지", maxLength: 100 }}
              sx={inputSx}
            />
          </SearchField>

          <SearchField
            label="여행 기간"
            labelFor="planme-duration"
            error={state.fieldErrors?.durationDays}
            divider
          >
            <ButtonBase
              id="planme-duration"
              aria-label="여행 기간 선택"
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
                  fontSize: { xs: 18, md: 20 },
                  fontWeight: 650,
                  whiteSpace: "nowrap",
                }}
              >
                {durationDays ? formatDuration(selectedDurationDays) : "기간 선택"}
              </Typography>
              <DarkModeOutlinedIcon sx={{ ml: 0.75, color: "#79859a", fontSize: 22 }} />
              <KeyboardArrowDownRoundedIcon sx={{ ml: 0.25, color: "#79859a", fontSize: 22 }} />
            </ButtonBase>

            <Popover
              open={Boolean(durationAnchor)}
              anchorEl={durationAnchor}
              onClose={() => setDurationAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
              transformOrigin={{ vertical: "top", horizontal: "center" }}
              slotProps={{
                root: {
                  sx: { pointerEvents: "none" },
                },
                paper: {
                  ref: durationPaperRef,
                  sx: {
                    pointerEvents: "auto",
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
                  aria-label="여행 기간 하루 줄이기"
                  disabled={selectedDurationDays <= 1}
                  onClick={() => selectDuration(selectedDurationDays - 1)}
                >
                  <RemoveRoundedIcon />
                </DurationStepButton>
                <Box sx={{ minWidth: 120, textAlign: "center" }}>
                  <Typography sx={{ color: "#17233c", fontSize: 25, fontWeight: 750 }}>
                    {formatDuration(selectedDurationDays)}
                  </Typography>
                  <Typography sx={{ mt: 0.5, color: "#8993a5", fontSize: 13.5, fontWeight: 600 }}>
                    최대 13박 14일
                  </Typography>
                </Box>
                <DurationStepButton
                  aria-label="여행 기간 하루 늘리기"
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
              >
                당일치기
              </Button>
            </Popover>
          </SearchField>

          <SearchField label="이동수단" error={state.fieldErrors?.transportMode}>
            <ToggleButtonGroup
              exclusive
              value={transportMode}
              onChange={(_event, value: TransportMode | null) => {
                if (value) {
                  setTransportMode(value);
                  rotateSubmissionId();
                }
              }}
              aria-label="이동수단"
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
              <TransportButton value="drive" aria-label="자동차">
                <DirectionsCarRoundedIcon fontSize="small" />
                자동차
              </TransportButton>
              <TransportButton value="transit" aria-label="대중교통">
                <DirectionsBusRoundedIcon fontSize="small" />
                대중교통
              </TransportButton>
            </ToggleButtonGroup>
          </SearchField>

          <Box sx={{ display: "flex", alignItems: "stretch", pl: { md: 2.25 } }}>
            <Button
              type="submit"
              variant="contained"
              disabled={pending}
              startIcon={
                pending ? <CircularProgress size={20} color="inherit" /> : <SearchRoundedIcon />
              }
              sx={{
                width: { xs: "100%", md: 158 },
                minHeight: { xs: 58, md: 106 },
                mt: { xs: 2.25, md: 0 },
                borderRadius: 2,
                bgcolor: "#1660df",
                boxShadow: "none",
                fontSize: 19,
                fontWeight: 750,
                "&:hover": { bgcolor: "#0f50c4", boxShadow: "none" },
              }}
            >
              검색
            </Button>
          </Box>

          {state.error ? (
            <Typography
              role="alert"
              color="error"
              sx={{ gridColumn: "1 / -1", mt: 1.5, px: 1, fontSize: 14 }}
            >
              {state.error}
            </Typography>
          ) : null}
        </Box>
      </Box>
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
  return (
    <Box
      sx={{
        minWidth: 0,
        px: { xs: 1, md: 2.75 },
        py: { xs: 2, md: 0.5 },
        borderBottom: { xs: divider ? "1px solid #e3e7ee" : "none", md: "none" },
        borderRight: { xs: "none", md: divider ? "1px solid #cfd6e2" : "none" },
      }}
    >
      <Typography
        component="label"
        htmlFor={labelFor}
        sx={{ display: "block", color: "#0967e8", fontSize: 16, fontWeight: 750 }}
      >
        {label}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
        {icon ? <Box sx={{ color: "#a0a9ba", display: "flex" }}>{icon}</Box> : null}
      </Stack>
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
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

const inputSx = {
  width: "100%",
  mt: 0.5,
  color: "#17233c",
  fontSize: { xs: 20, md: 23 },
  fontWeight: 650,
  "& input": { py: 0.5 },
  "& input::placeholder": { color: "#8993a5", opacity: 1 },
};
