import { Router } from "express";
import { initUpload, completeUpload } from "../controllers/uploadOrders.controller.js";
import { getUploadJob } from "../controllers/getUploadJob.controller.js";
import { getOrders } from "../controllers/getOrders.controller.js";
import { getOrderById } from "../controllers/getOrderById.controller.js";

export const ordersRouter = Router();

ordersRouter.post("/upload-orders/init", initUpload);
ordersRouter.post("/upload-orders/complete", completeUpload);
ordersRouter.get("/upload-orders/:jobId", getUploadJob);
ordersRouter.get("/orders", getOrders);
ordersRouter.get("/orders/:orderId", getOrderById);
