import { createTheme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface TypographyVariants {
    mono: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    mono?: React.CSSProperties;
  }
}
declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    mono: true;
  }
}

const border = "#1F2937";

export const theme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#0B0F17",
      paper: "#111827",
    },
    primary: { main: "#F59E0B" },
    info: { main: "#06B6D4" },
    error: { main: "#EF4444" },
    divider: border,
    text: {
      primary: "#E5E7EB",
      secondary: "#9CA3AF",
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    mono: {
      fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
      fontFeatureSettings: '"tnum"',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage:
            "linear-gradient(#1F2937 1px, transparent 1px), linear-gradient(90deg, #1F2937 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          backgroundAttachment: "fixed",
          backgroundColor: "#0B0F17",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          border: `1px solid ${border}`,
          backgroundImage: "none",
          backgroundColor: "rgba(17, 24, 39, 0.85)",
          backdropFilter: "blur(8px)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: `1px solid ${border}`,
          backgroundImage: "none",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 6,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: '"JetBrains Mono", monospace',
          borderRadius: 4,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: border,
        },
      },
    },
  },
});
