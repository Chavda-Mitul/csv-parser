import { Box, Grid, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useSnackbar } from "notistack";
import type { UploadResult } from "../api/types";

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="mono" sx={{ fontSize: 28, fontWeight: 700, color: color ?? "text.primary" }}>
        {value.toLocaleString()}
      </Typography>
    </Paper>
  );
}

export function MetricsSummary({ result }: { result: UploadResult }) {
  const { enqueueSnackbar } = useSnackbar();

  const copyPath = () => {
    navigator.clipboard.writeText(result.file);
    enqueueSnackbar("GCS path copied to clipboard", { variant: "success" });
  };

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile label="Total Rows Processed" value={result.totalRows} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile label="Successful DB Inserts" value={result.successfulRows} color="#06B6D4" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatTile label="Malformed / Skipped Rows" value={result.failedRows} color="#EF4444" />
        </Grid>
      </Grid>
      <Paper sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box sx={{ overflow: "hidden" }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            GCS Destination
          </Typography>
          <Typography variant="mono" sx={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
            {result.file}
          </Typography>
        </Box>
        <Tooltip title="Copy path">
          <IconButton onClick={copyPath} size="small">
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Paper>
    </Stack>
  );
}
