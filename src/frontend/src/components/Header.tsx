import { useEffect, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import SensorsIcon from "@mui/icons-material/Sensors";
import { getHealth } from "../api/client";

export function Header() {
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => getHealth().then((ok) => !cancelled && setHealthy(ok));
    check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dotColor = healthy === null ? "#6B7280" : healthy ? "#06B6D4" : "#EF4444";

  return (
    <Stack
      direction="row"
      sx={{
        alignItems: "center",
        justifyContent: "space-between",
        px: 3,
        py: 2,
        borderBottom: "1px solid #1F2937",
        backgroundColor: "rgba(11, 15, 23, 0.9)",
        backdropFilter: "blur(8px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <SensorsIcon sx={{ color: "primary.main" }} />
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
          Sentinel Ingest
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ pl: 1 }}>
          Order Processing Deck
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            backgroundColor: dotColor,
            boxShadow: `0 0 8px ${dotColor}`,
          }}
        />
        <Typography variant="mono" sx={{ fontSize: 12, color: "text.secondary" }}>
          {healthy === null ? "CHECKING" : healthy ? "API ONLINE" : "API UNREACHABLE"}
        </Typography>
      </Stack>
    </Stack>
  );
}
