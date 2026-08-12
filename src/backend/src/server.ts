import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { connectDB } from "./db/pool.js";
import { boss } from "./db/pgBoss.js";
import { registerUploadOrdersWorker } from "./jobs/uploadOrders.job.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { registerShutdownHandlers, setServer } from "./shutdown.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN }));
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/metrics", (_req, res) => {
  res.json(metrics.snapshot());
});

app.use(ordersRouter);

app.use(notFoundHandler);
app.use(errorHandler);

registerShutdownHandlers();

async function bootstrap() {
  try {
    await connectDB();
    await boss.start();
    await registerUploadOrdersWorker();
    setServer(
      app.listen(port, () => {
        logger.info(`Server listening on port ${port}`);
      }),
    );
  } catch (error) {
    logger.error(error, "Failed to start");
    process.exit(1);
  }
}

bootstrap();
