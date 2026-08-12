import { Router } from "express";
import { validateUpload } from "../middleware/validateUpload.js";
import { uploadOrders } from "../controllers/uploadOrders.controller.js";
import { getUploadJob } from "../controllers/getUploadJob.controller.js";
import { getOrders } from "../controllers/getOrders.controller.js";
import { getOrderById } from "../controllers/getOrderById.controller.js";

export const ordersRouter = Router();

ordersRouter.post("/upload-orders", validateUpload, uploadOrders);
ordersRouter.get("/upload-orders/:jobId", getUploadJob);
ordersRouter.get("/orders", getOrders);
ordersRouter.get("/orders/:orderId", getOrderById);
