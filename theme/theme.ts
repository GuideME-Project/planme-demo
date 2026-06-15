import { createTheme } from "@mui/material/styles";

export type PlanmeThemeMode = "light" | "dark";

/**
 * Creates the PlanME MUI theme for the requested color mode.
 */
export function createPlanmeTheme(mode: PlanmeThemeMode) {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? "#3b82f6" : "#2563eb",
        dark: "#1746a2",
      },
      secondary: {
        main: isDark ? "#22c55e" : "#16a34a",
      },
      error: {
        main: "#ef4444",
      },
      background: {
        default: isDark ? "#0f1720" : "#f4f6fb",
        paper: isDark ? "#151d28" : "#ffffff",
      },
      text: {
        primary: isDark ? "#f8fafc" : "#172033",
        secondary: isDark ? "#a7b0bf" : "#5b667a",
      },
      divider: isDark ? "rgba(148, 163, 184, 0.2)" : "rgba(23, 32, 51, 0.1)",
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily: "var(--font-geist-sans), Arial, sans-serif",
      h1: {
        fontSize: "2.35rem",
        fontWeight: 780,
        lineHeight: 1.18,
      },
      h2: {
        fontSize: "1.65rem",
        fontWeight: 740,
        lineHeight: 1.25,
      },
      h3: {
        fontSize: "1.2rem",
        fontWeight: 720,
        lineHeight: 1.35,
      },
      button: {
        fontWeight: 700,
        textTransform: "none",
      },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderColor: isDark
              ? "rgba(148, 163, 184, 0.22)"
              : "rgba(23, 32, 51, 0.08)",
            boxShadow: isDark
              ? "0 20px 60px rgba(0, 0, 0, 0.25)"
              : "0 18px 50px rgba(23, 32, 51, 0.08)",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 700,
          },
        },
      },
    },
  });
}
