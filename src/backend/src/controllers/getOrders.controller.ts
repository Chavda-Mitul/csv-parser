import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getShardPoolForCustomer } from "../db/shardRouter.js";

const queryCustomerSchema = z.object({
  customerId: z.string().trim().min(1),
});

export const getOrders = asyncHandler(async (req, res) => {
  const result = queryCustomerSchema.safeParse(req.query);
  if (!result.success) {
    throw new AppError(
      400,
      result.error.issues[0]?.message ?? "customerId is required",
    );
  }
  const { customerId } = result.data;

  const pool = getShardPoolForCustomer(customerId);
  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE customer_id = $1 ORDER BY order_date DESC",
    [customerId],
  );

  res.status(200).json(rows);
});
