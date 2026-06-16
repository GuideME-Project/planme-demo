"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createPlanmeTheme,
  type PlanmeThemeMode,
} from "@/theme/theme";

type ThemeRegistryProps = {
  children: ReactNode;
};

type PlanmeColorModeContextValue = {
  mode: PlanmeThemeMode;
  toggleMode: () => void;
};

const PlanmeColorModeContext =
  createContext<PlanmeColorModeContextValue | null>(null);

/**
 * Returns the active PlanME color mode controller.
 */
export function usePlanmeColorMode(): PlanmeColorModeContextValue {
  const context = useContext(PlanmeColorModeContext);

  if (!context) {
    throw new Error("usePlanmeColorMode must be used inside ThemeRegistry");
  }

  return context;
}

/**
 * Wires MUI's cache provider and PlanME theme into the Next.js App Router tree.
 */
export function ThemeRegistry({ children }: ThemeRegistryProps) {
  const [mode, setMode] = useState<PlanmeThemeMode>("light");

  useEffect(() => {
    window.localStorage.setItem("planme-theme-mode", mode);
    document.documentElement.dataset.planmeTheme = mode;
  }, [mode]);

  const theme = useMemo(() => createPlanmeTheme(mode), [mode]);

  const colorModeValue = useMemo<PlanmeColorModeContextValue>(
    () => ({
      mode,
      toggleMode: () => {
        // Keep the dashboard mode toggle deterministic and local to this demo.
        setMode((currentMode) => (currentMode === "dark" ? "light" : "dark"));
      },
    }),
    [mode],
  );

  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <PlanmeColorModeContext.Provider value={colorModeValue}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </PlanmeColorModeContext.Provider>
    </AppRouterCacheProvider>
  );
}
