"use client";

import { Autocomplete, Box, Paper, TextField, Typography, type PaperProps } from "@mui/material";
import { useEffect, useRef, useState, type Ref } from "react";
import type { PlanmePlaceSelection, PlanmePlaceSuggestion, PlanmePlaceSuggestionsResponse } from "@/lib/planme-places";

type PlanmePlaceInputProps = {
  id: string;
  name: "origin" | "destination";
  label: string;
  value: string;
  selection: PlanmePlaceSelection | null;
  disabled: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onValueChange: (value: string, selection: PlanmePlaceSelection | null) => void;
};

export function PlanmePlaceInput({ id, name, label, value, selection, disabled, inputRef, onValueChange }: PlanmePlaceInputProps) {
  const [opened, setOpened] = useState(false);
  const [suggestions, setSuggestions] = useState<PlanmePlaceSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const tokenRef = useRef("");
  const versionRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const open = opened && value.trim().length >= 2 && !selection && !disabled;

  const cancelRequest = () => {
    versionRef.current += 1;
    requestRef.current?.abort();
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const version = versionRef.current;
    const timer = window.setTimeout(async () => {
      tokenRef.current ||= crypto.randomUUID();
      try {
        const response = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: value.trim(), sessionToken: tokenRef.current }),
          signal: controller.signal,
        });
        const payload = await response.json() as PlanmePlaceSuggestionsResponse;
        if (controller.signal.aborted || version !== versionRef.current) return;
        setSuggestions(response.ok ? payload.suggestions : []);
        setMessage(response.ok ? "" : payload.message ?? "후보를 불러오지 못했습니다. 직접 입력해 검색할 수 있어요.");
        setLoaded(true);
      } catch {
        if (controller.signal.aborted || version !== versionRef.current) return;
        setSuggestions([]);
        setMessage("후보를 불러오지 못했습니다. 직접 입력해 검색할 수 있어요.");
        setLoaded(true);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, value]);

  return (
    <Box sx={{ minWidth: 0 }}>
      <Autocomplete
        id={id}
        freeSolo
        disableClearable
        openOnFocus
        clearOnBlur={false}
        autoSelect={false}
        disabled={disabled}
        value={selection ?? value}
        inputValue={value}
        options={suggestions}
        open={open}
        onOpen={() => setOpened(true)}
        onClose={() => { cancelRequest(); setOpened(false); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
            event.preventDefault();
            event.defaultMuiPrevented = true;
          }
        }}
        filterOptions={(options) => options}
        getOptionLabel={(option) => typeof option === "string" ? option : option.name}
        getOptionKey={(option) => typeof option === "string" ? option : option.placeId}
        isOptionEqualToValue={(option, selected) => typeof selected !== "string" && option.placeId === selected.placeId}
        onInputChange={(_event, nextValue, reason) => {
          if (reason !== "input") return;
          cancelRequest();
          setSuggestions([]);
          setMessage("");
          setLoaded(false);
          setOpened(true);
          onValueChange(nextValue, null);
        }}
        onChange={(_event, selected) => {
          if (typeof selected === "string") {
            if (selected !== value) onValueChange(selected, null);
            return;
          }
          if (!selected) return;
          const chosen = { ...selected, sessionToken: tokenRef.current };
          cancelRequest();
          tokenRef.current = "";
          setOpened(false);
          onValueChange(selected.name, chosen);
        }}
        loading={!loaded}
        loadingText="장소 후보를 찾고 있어요…"
        noOptionsText={message || "후보가 없습니다. 직접 입력해 검색할 수 있어요."}
        slots={{ paper: SuggestionsPaper }}
        slotProps={{
          popper: { placement: "bottom-start", sx: { zIndex: 1301, minWidth: { md: 320 }, maxWidth: "calc(100vw - 32px)" } },
          listbox: { sx: { maxHeight: 280, py: 0.5 } },
        }}
        renderOption={({ key, ...props }, option) => (
          <Box component="li" key={key} {...props} sx={{ display: "block !important", py: "10px !important", overflowWrap: "anywhere" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#243954" }}>{option.name}</Typography>
            <Typography sx={{ mt: 0.3, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{option.address}</Typography>
          </Box>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            inputRef={inputRef}
            name={name}
            placeholder={label}
            variant="standard"
            slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": label, maxLength: 100 } }}
          />
        )}
        sx={{ width: "100%", mt: 0.5,
          "& .MuiInputBase-root": { color: "#17233c", fontSize: { xs: 20, md: 23 }, fontWeight: 650 },
          "& .MuiInput-root::before, & .MuiInput-root::after, & .MuiInput-root:hover:not(.Mui-disabled)::before": { borderBottom: "none" },
          "& input::placeholder": { color: "#8993a5", opacity: 1 },
        }}
      />
      {open && suggestions.length === 0 ? <Typography role="status" sx={{ mt: 0.75, color: "#64748b", fontSize: 12 }}>{!loaded ? "장소 후보를 찾고 있어요…" : message || "후보가 없습니다. 직접 입력해 검색할 수 있어요."}</Typography> : null}
      {selection?.address ? <Typography sx={{ mt: 0.75, color: "#64748b", fontSize: 12, overflowWrap: "anywhere" }}>{selection.address} · <Box component="span" translate="no" sx={{ fontFamily: "Arial, sans-serif", color: "#5e5e5e" }}>Google Maps</Box></Typography> : null}
    </Box>
  );
}

function SuggestionsPaper({ children, ...props }: PaperProps) {
  return (
    <Paper {...props} sx={{ border: "1px solid #d9e3f0", borderRadius: 2, mt: 1, boxShadow: "0 12px 28px rgba(23,50,91,0.14)", overflow: "hidden" }}>
      {children}
      <Typography translate="no" sx={{ borderTop: "1px solid #edf1f6", px: 2, py: 1, color: "#5e5e5e", fontFamily: "Arial, sans-serif", fontSize: 12, fontWeight: 400, letterSpacing: "normal", whiteSpace: "nowrap" }}>Google Maps</Typography>
    </Paper>
  );
}
