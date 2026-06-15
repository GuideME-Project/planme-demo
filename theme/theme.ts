import { createTheme } from "@mui/material/styles";

export const planmeTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#2563eb",
      dark: "#1746a2",
    },
    secondary: {
      main: "#16a34a",
    },
    background: {
      default: "#f4f6fb",
      paper: "#ffffff",
    },
    text: {
      primary: "#172033",
      secondary: "#5b667a",
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: "var(--font-geist-sans), Arial, sans-serif",
    h1: {
      fontSize: "2.35rem",
      fontWeight: 760,
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
          borderColor: "rgba(23, 32, 51, 0.08)",
          boxShadow: "0 18px 50px rgba(23, 32, 51, 0.08)",
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
