import {
  getAllShardPools,
  getShardPoolForCustomer,
} from "./shardRouter.js";

export async function findOrdersByCustomer(customerId: string) {
  const pool = getShardPoolForCustomer(customerId);
  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE customer_id = $1 ORDER BY order_date DESC",
    [customerId],
  );
  return rows;
}

export async function findOrderById(orderId: string) {
  const results = await Promise.all(
    getAllShardPools().map((pool) =>
      pool.query("SELECT * FROM orders WHERE order_id = $1", [orderId]),
    ),
  );
  return results.flatMap((r) => r.rows)[0];
}
