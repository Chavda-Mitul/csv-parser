import { ThemeProvider, CssBaseline, Container, Stack } from "@mui/material";
import { SnackbarProvider } from "notistack";
import { theme } from "./theme";
import { Header } from "./components/Header";
import { UploadWorkspace } from "./components/UploadWorkspace";
import { QueryWorkspace } from "./components/QueryWorkspace";

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider maxSnack={4} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Header />
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Stack spacing={5}>
            <UploadWorkspace />
            <QueryWorkspace />
          </Stack>
        </Container>
      </SnackbarProvider>
    </ThemeProvider>
  );
}
