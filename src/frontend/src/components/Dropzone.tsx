import { useRef, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useSnackbar } from "notistack";

const MAX_BYTES = 50 * 1024 * 1024;

interface DropzoneProps {
  disabled?: boolean;
  onFile: (file: File) => void;
}

export function Dropzone({ disabled, onFile }: DropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { enqueueSnackbar } = useSnackbar();

  const validate = (file: File): boolean => {
    const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
    if (!isCsv) {
      enqueueSnackbar("Invalid file format: Only .csv files are supported", {
        variant: "error",
      });
      return false;
    }
    if (file.size > MAX_BYTES) {
      enqueueSnackbar("File size exceeds 50MB limit", { variant: "error" });
      return false;
    }
    return true;
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (validate(file)) onFile(file);
  };

  return (
    <Box
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      sx={{
        border: "1px dashed",
        borderColor: dragActive ? "primary.main" : "#1F2937",
        borderRadius: 2,
        p: 5,
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        backgroundColor: dragActive ? "rgba(245, 158, 11, 0.06)" : "transparent",
        transition: "border-color 120ms, background-color 120ms",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Stack spacing={1.5} sx={{ alignItems: "center" }}>
        <UploadFileIcon sx={{ fontSize: 36, color: "primary.main" }} />
        <Typography variant="body1">Drag & drop an order CSV, or click to browse</Typography>
        <Typography variant="mono" sx={{ fontSize: 12, color: "text.secondary" }}>
          .csv only · max 50MB
        </Typography>
      </Stack>
    </Box>
  );
}
