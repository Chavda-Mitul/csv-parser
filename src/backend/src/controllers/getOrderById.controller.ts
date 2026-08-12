import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { findOrderById } from "../db/ordersRepository.js";

const paramsOrderIdSchema = z.object({
  orderId: z.string().trim().min(1),
});

export const getOrderById = asyncHandler(async (req, res) => {
  const result = paramsOrderIdSchema.safeParse(req.params);
  if (!result.success) {
    throw new AppError(
      400,
      result.error.issues[0]?.message ?? "orderId is required",
    );
  }
  const { orderId } = result.data;

  const order = await findOrderById(orderId);

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  res.status(200).json(order);
});
