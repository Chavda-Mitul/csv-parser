import { useState } from "react";
import {
  Box,
  Chip,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import HubIcon from "@mui/icons-material/Hub";
import { useSnackbar } from "notistack";
import { getOrderById, getOrdersByCustomer, ApiError } from "../api/client";
import { getShardIndex } from "../lib/crc32";
import type { OrderRow } from "../api/types";

const SHARD_COUNT = Number(import.meta.env.VITE_SHARD_COUNT ?? 3);

function OrdersTable({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        No orders found.
      </Typography>
    );
  }
  return (
    <TableContainer sx={{ mt: 2, maxHeight: 360 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Order ID</TableCell>
            <TableCell>Date</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.order_id} hover>
              <TableCell>
                <Typography variant="mono" sx={{ fontSize: 12 }}>
                  {o.order_id}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="mono" sx={{ fontSize: 12 }}>
                  {new Date(o.order_date).toLocaleString()}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="mono" sx={{ fontSize: 12 }}>
                  ${o.order_amount}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip label={o.status} size="small" variant="outlined" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CustomerQueryTab() {
  const [customerId, setCustomerId] = useState("");
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const { enqueueSnackbar } = useSnackbar();

  const shardIndex = customerId.trim() ? getShardIndex(customerId.trim(), SHARD_COUNT) : null;

  const search = async () => {
    const id = customerId.trim();
    if (!id) return;
    setLoading(true);
    try {
      setOrders(await getOrdersByCustomer(id));
    } catch (err) {
      enqueueSnackbar(err instanceof Error ? err.message : "Query failed", { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <TextField
          size="small"
          label="Customer ID"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          sx={{ flex: 1 }}
        />
        {shardIndex !== null && (
          <Chip
            label={`SHARD ${shardIndex}`}
            size="small"
            sx={{ fontFamily: '"JetBrains Mono", monospace', color: "info.main", borderColor: "info.main" }}
            variant="outlined"
          />
        )}
      </Stack>
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Querying…
        </Typography>
      ) : (
        orders && <OrdersTable orders={orders} />
      )}
    </Stack>
  );
}

function OrderLookupTab() {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(false);
  const { enqueueSnackbar } = useSnackbar();

  const search = async () => {
    const id = orderId.trim();
    if (!id) return;
    setLoading(true);
    setOrder(null);
    try {
      setOrder(await getOrderById(id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        enqueueSnackbar("Order not found", { variant: "error" });
      } else {
        enqueueSnackbar(err instanceof Error ? err.message : "Lookup failed", { variant: "error" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2}>
      <TextField
        size="small"
        label="Order ID (UUID)"
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && search()}
      />
      {loading && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <HubIcon sx={{ color: "info.main" }} className="pulse" />
          <Typography variant="body2" color="text.secondary">
            Scatter-gathering across shards…
          </Typography>
        </Stack>
      )}
      {order && (
        <Paper sx={{ p: 2.5 }}>
          <Stack spacing={1}>
            <Row label="Order ID" value={order.order_id} />
            <Row label="Customer ID" value={order.customer_id} />
            <Row label="Date" value={new Date(order.order_date).toLocaleString()} />
            <Row label="Amount" value={`$${order.order_amount}`} />
            <Row label="Status" value={order.status} />
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between" }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="mono" sx={{ fontSize: 13 }}>
        {value}
      </Typography>
    </Stack>
  );
}

export function QueryWorkspace() {
  const [tab, setTab] = useState(0);
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        Data Query & Shard Inspection
      </Typography>
      <Paper sx={{ p: 2.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 36 }}>
          <Tab label="Customer Query" sx={{ minHeight: 36 }} />
          <Tab label="Scatter-Gather Lookup" sx={{ minHeight: 36 }} />
        </Tabs>
        <Box hidden={tab !== 0}>
          <CustomerQueryTab />
        </Box>
        <Box hidden={tab !== 1}>
          <OrderLookupTab />
        </Box>
      </Paper>
    </Stack>
  );
}
