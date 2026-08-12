import { useMemo, useState } from "react";
import {
  Chip,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { RowError } from "../api/types";

export function ErrorLogTable({ rowErrors }: { rowErrors: RowError[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rowErrors;
    return rowErrors.filter(
      (e) => String(e.row).includes(q) || e.reason.toLowerCase().includes(q),
    );
  }, [rowErrors, query]);

  if (rowErrors.length === 0) return null;

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Data Error Log
        </Typography>
        <TextField
          size="small"
          placeholder="Filter by line # or reason"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 280 }}
        />
      </Stack>
      <TableContainer sx={{ maxHeight: 360 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Line #</TableCell>
              <TableCell>Field Error</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((e, i) => (
              <TableRow key={i} hover>
                <TableCell>
                  <Typography variant="mono" sx={{ fontSize: 13 }}>
                    {e.row}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={e.reason}
                    size="small"
                    variant="outlined"
                    color="error"
                    sx={{ height: "auto", "& .MuiChip-label": { whiteSpace: "normal", py: 0.5 } }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
