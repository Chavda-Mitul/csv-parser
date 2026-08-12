import { useEffect, useRef, useState } from "react";
import { LinearProgress, Paper, Stack, Typography } from "@mui/material";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import { useSnackbar } from "notistack";
import { Dropzone } from "./Dropzone";
import { MetricsSummary } from "./MetricsSummary";
import { ErrorLogTable } from "./ErrorLogTable";
import { uploadOrders, getUploadJobStatus } from "../api/client";
import type { UploadResult } from "../api/types";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

const POLL_INTERVAL_MS = 2000;

export function UploadWorkspace() {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResult | null>(null);
  const { enqueueSnackbar } = useSnackbar();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollJob = (jobId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const job = await getUploadJobStatus(jobId);
        if (job.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          setResult(job);
          setStatus("done");
          enqueueSnackbar("Ingestion complete", { variant: "success" });
        } else if (job.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("error");
          enqueueSnackbar(job.error, { variant: "error" });
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStatus("error");
        enqueueSnackbar(err instanceof Error ? err.message : "Failed to check upload status", {
          variant: "error",
        });
      }
    }, POLL_INTERVAL_MS);
  };

  const handleFile = async (file: File) => {
    setStatus("uploading");
    setProgress(0);
    setResult(null);
    try {
      const { jobId } = await uploadOrders(file, setProgress);
      setStatus("processing");
      pollJob(jobId);
    } catch (err) {
      setStatus("error");
      enqueueSnackbar(err instanceof Error ? err.message : "Upload failed", {
        variant: "error",
      });
    }
  };

  return (
    <Stack spacing={2.5}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        Ingestion Upload Workspace
      </Typography>

      <Dropzone disabled={status === "uploading" || status === "processing"} onFile={handleFile} />

      {(status === "uploading" || status === "processing") && (
        <Paper sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: "center" }}>
            <CloudSyncIcon sx={{ color: "info.main" }} className="pulse" />
            <Typography variant="body2" color="text.secondary">
              {status === "uploading"
                ? "Uploading file..."
                : "Streaming to GCS & Shard Routing across databases..."}
            </Typography>
          </Stack>
          <LinearProgress
            variant={status === "uploading" && progress > 0 ? "determinate" : "indeterminate"}
            value={progress}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: "#1F2937",
              "& .MuiLinearProgress-bar": { backgroundColor: "info.main" },
            }}
          />
        </Paper>
      )}

      {status === "done" && result && (
        <>
          <MetricsSummary result={result} />
          <ErrorLogTable rowErrors={result.rowErrors} />
        </>
      )}
    </Stack>
  );
}
