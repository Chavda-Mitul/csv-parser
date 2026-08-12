import { Router } from "express";
import { validateUpload } from "../middleware/validateUpload.js";
import { uploadOrders } from "../controllers/uploadOrders.controller.js";
import { getOrders } from "../controllers/getOrders.controller.js";

export const ordersRouter = Router();

ordersRouter.post("/upload-orders", validateUpload, uploadOrders);
ordersRouter.get("/orders", getOrders);
