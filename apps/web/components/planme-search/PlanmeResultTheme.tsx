"use client";

import { createTheme, ThemeProvider, useTheme } from "@mui/material/styles";
import { useMemo, type ReactNode } from "react";

// Match the home page's blue headings, muted copy, and pale card surfaces.
export const resultColors = {
  heading: "#124b97",
  body: "#31577d",
  muted: "#62738c",
  primary: "#185ac0",
  surface: "#f5f9ff",
  border: "#dce7f5",
};

export function PlanmeResultTheme({ children }: { children: ReactNode }) {
  const parentTheme = useTheme();
  const theme = useMemo(() => createTheme(parentTheme, {
    palette: {
      primary: { main: resultColors.primary },
      text: { primary: resultColors.body, secondary: resultColors.muted },
      background: { default: "#ffffff", paper: "#ffffff" },
      divider: resultColors.border,
    },
    typography: {
      h1: { color: resultColors.heading, fontWeight: 780, letterSpacing: "-0.045em" },
      h2: { color: resultColors.heading, fontWeight: 740 },
      h3: { color: resultColors.heading, fontWeight: 700 },
    },
  }), [parentTheme]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
